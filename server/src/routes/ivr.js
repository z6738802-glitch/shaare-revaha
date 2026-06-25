'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../db');
const {
  RIDES,
  STATIONS_A,
  STATIONS_B,
  TOTAL_SEATS,
  BOOKING_WINDOW_BEITAR,
  BOOKING_WINDOW_HADASSAH,
  MAX_SEATS_PER_PHONE,
  CANCEL_WINDOW,
} = require('../data');
const { todayIL, canBook, canCancel, timeToMinutes, nowTimeIL } = require('../time');

// ────────────────────────────────────────────────
// עזר: ספירת מושבים תפוסים לנסיעה היום
// ────────────────────────────────────────────────
async function takenSeats(rideId, date) {
  const res = await pool.query(
    `SELECT COALESCE(SUM(seats_count), 0) AS taken
     FROM shaare_revaha.bookings
     WHERE date = $1 AND ride_id = $2 AND status = 'active'`,
    [date, rideId]
  );
  return parseInt(res.rows[0].taken);
}

// ────────────────────────────────────────────────
// עזר: כמה מושבים הטלפון כבר הזמין לנסיעה זו
// ────────────────────────────────────────────────
async function seatsForPhone(phone, rideId, date) {
  const res = await pool.query(
    `SELECT COALESCE(SUM(seats_count), 0) AS taken
     FROM shaare_revaha.bookings
     WHERE phone = $1 AND date = $2 AND ride_id = $3 AND status = 'active'`,
    [phone, date, rideId]
  );
  return parseInt(res.rows[0].taken);
}

// ────────────────────────────────────────────────
// שלב 1: בדיקת זמינות נסיעה
// ימות שולחת: ApiPhone, RIDE (1-8), SEATS (1-3)
// ────────────────────────────────────────────────
router.get('/book', async (req, res) => {
  const { ApiPhone, RIDE, SEATS } = req.query;

  if (!ApiPhone || !RIDE || !SEATS) {
    return res.send('id_list_message=f-/32/error');
  }

  const rideId = parseInt(RIDE);
  const seats = parseInt(SEATS);
  const date = todayIL();

  // בדיקה שהנסיעה קיימת
  const ride = RIDES.find(r => r.id === rideId);
  if (!ride) {
    return res.send('id_list_message=f-/32/error');
  }

  // בדיקת חלון הזמן
  const window = ride.direction === 'beitar_hadassah'
    ? BOOKING_WINDOW_BEITAR
    : BOOKING_WINDOW_HADASSAH;

  if (!canBook(ride.departure_time, window)) {
    // מחוץ לחלון הזמן
    return res.send('id_list_message=f-/32/time_closed');
  }

  // בדיקת מושבים כלליים
  const taken = await takenSeats(rideId, date);
  const available = TOTAL_SEATS - taken;

  if (available < seats) {
    // נסיעה מלאה
    return res.send('id_list_message=f-/32/full');
  }

  // בדיקת מגבלת טלפון
  const alreadyBooked = await seatsForPhone(ApiPhone, rideId, date);
  if (alreadyBooked + seats > MAX_SEATS_PER_PHONE) {
    return res.send('id_list_message=f-/32/limit_reached');
  }

  // הכל תקין — שאל גבעה
  return res.send('read=f-/32/ask_neighborhood=NEIGHBORHOOD,,1,1,1,Number,yes,yes,,,,Ok,,,,no,');
});

// ────────────────────────────────────────────────
// שלב 2: קיבלנו גבעה — שאל תחנה
// ימות שולחת: ApiPhone, RIDE, SEATS, NEIGHBORHOOD (1 או 2)
// ────────────────────────────────────────────────
router.get('/neighborhood', (req, res) => {
  const { NEIGHBORHOOD } = req.query;

  if (!NEIGHBORHOOD) {
    return res.send('id_list_message=f-/32/error');
  }

  if (NEIGHBORHOOD === '1') {
    // גבעה A
    return res.send('read=f-/32/stations_a=STATION,,2,1,2,Number,yes,yes,,,,Ok,,,,no,');
  } else {
    // גבעה B
    return res.send('read=f-/32/stations_b=STATION,,2,1,2,Number,yes,yes,,,,Ok,,,,no,');
  }
});

// ────────────────────────────────────────────────
// שלב 3: קיבלנו תחנה — שמור הזמנה
// ימות שולחת: ApiPhone, RIDE, SEATS, NEIGHBORHOOD, STATION
// ────────────────────────────────────────────────
router.get('/station', async (req, res) => {
  const { ApiPhone, RIDE, SEATS, NEIGHBORHOOD, STATION } = req.query;

  if (!ApiPhone || !RIDE || !SEATS || !NEIGHBORHOOD || !STATION) {
    return res.send('id_list_message=f-/32/error');
  }

  const rideId = parseInt(RIDE);
  const seats = parseInt(SEATS);
  const station = parseInt(STATION);
  const neighborhood = NEIGHBORHOOD === '1' ? 'A' : 'B';
  const date = todayIL();

  // בדיקת תקינות תחנה
  if (station < 1 || station > 12) {
    return res.send('id_list_message=f-/32/error');
  }

  // שמירה עם נעילה למניעת concurrency
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // בדיקה סופית עם נעילה
    const check = await client.query(
      `SELECT COALESCE(SUM(seats_count), 0) AS taken
       FROM shaare_revaha.bookings
       WHERE date = $1 AND ride_id = $2 AND status = 'active'
       FOR UPDATE`,
      [date, rideId]
    );
    const taken = parseInt(check.rows[0].taken);

    if (TOTAL_SEATS - taken < seats) {
      await client.query('ROLLBACK');
      return res.send('id_list_message=f-/32/full');
    }

    // שמירת ההזמנה
    const insert = await client.query(
      `INSERT INTO shaare_revaha.bookings
         (phone, date, ride_id, neighborhood, station, seats_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [ApiPhone, date, rideId, neighborhood, station, seats]
    );

    await client.query('COMMIT');

    // מזהה קצר לאישור (4 ספרות אחרונות של UUID ללא מקפים)
    const bookingId = insert.rows[0].id;
    const shortId = bookingId.replace(/-/g, '').slice(-4).toUpperCase();

    // המר ל-4 ספרות שניתן לנגן בימות
    // ימות מנגן n- כמספר, אז שולחים כל ספרה בנפרד
    const digits = shortId.split('').map(c => {
      // ימות תנגן אותיות כספרה hex אם נשמור כ-hex chars
      // פשוט יותר: נשתמש ב-4 ספרות מספריות בלבד
      return c;
    }).join('.');

    return res.send(
      `id_list_message=f-/32/confirmed.n-${shortId}`
    );

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('booking error:', err.message);
    return res.send('id_list_message=f-/32/error');
  } finally {
    client.release();
  }
});

// ────────────────────────────────────────────────
// ביטול שלב 1: קיבלנו קוד ביטול
// ימות שולחת: ApiPhone, CANCEL_CODE (4 ספרות)
// ────────────────────────────────────────────────
router.get('/cancel', async (req, res) => {
  const { ApiPhone, CANCEL_CODE } = req.query;

  if (!ApiPhone || !CANCEL_CODE) {
    return res.send('id_list_message=f-/32/error');
  }

  const code = CANCEL_CODE.toUpperCase();
  const date = todayIL();

  // חיפוש ההזמנה
  const find = await pool.query(
    `SELECT b.id, b.ride_id
     FROM shaare_revaha.bookings b
     WHERE b.phone = $1
       AND b.date = $2
       AND b.status = 'active'
       AND UPPER(RIGHT(REPLACE(b.id::text, '-', ''), 4)) = $3`,
    [ApiPhone, date, code]
  );

  if (find.rows.length === 0) {
    return res.send('id_list_message=f-/32/cancel_not_found');
  }

  const booking = find.rows[0];
  const ride = RIDES.find(r => r.id === booking.ride_id);

  // בדיקת חלון ביטול
  if (!canCancel(ride.departure_time)) {
    return res.send('id_list_message=f-/32/cancel_too_late');
  }

  // ביטול
  await pool.query(
    `UPDATE shaare_revaha.bookings
     SET status = 'cancelled', cancelled_at = NOW()
     WHERE id = $1`,
    [booking.id]
  );

  return res.send('id_list_message=f-/32/cancel_confirmed');
});

module.exports = router;
