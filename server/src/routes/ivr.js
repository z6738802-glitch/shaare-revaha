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
// עזר: יצירת קוד אישור מספרי ייחודי בן 4 ספרות
// בודק שאינו קיים כבר באותו יום (עם נעילה דרך הטרנזקציה)
// ────────────────────────────────────────────────
async function generateBookingCode(client, date) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = String(Math.floor(1000 + Math.random() * 9000)); // 1000-9999
    const exists = await client.query(
      `SELECT 1 FROM shaare_revaha.bookings
       WHERE date = $1 AND booking_code = $2 LIMIT 1`,
      [date, code]
    );
    if (exists.rows.length === 0) return code;
  }
  throw new Error('failed to generate unique booking code');
}

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
  const { ApiPhone, RIDE, SEATS, ApiTime } = req.query;

  if (!ApiPhone || !RIDE || !SEATS) {
    return res.send('id_list_message=f-32/006');
  }

  const rideId = parseInt(RIDE);
  const seats = parseInt(SEATS);
  const date = todayIL(ApiTime);

  // בדיקה שהנסיעה קיימת
  const ride = RIDES.find(r => r.id === rideId);
  if (!ride) {
    return res.send('id_list_message=f-32/006');
  }

  // בדיקת חלון הזמן
  const window = ride.direction === 'beitar_hadassah'
    ? BOOKING_WINDOW_BEITAR
    : BOOKING_WINDOW_HADASSAH;

  if (!canBook(ride.departure_time, window, ApiTime)) {
    // מחוץ לחלון הזמן — 32/007 "ההזמנה נסגרה לשעה זו"
    return res.send('id_list_message=f-32/007');
  }

  // בדיקת מושבים כלליים
  const taken = await takenSeats(rideId, date);
  const available = TOTAL_SEATS - taken;

  if (available < seats) {
    // נסיעה מלאה — 32/000
    return res.send('id_list_message=f-32/000');
  }

  // הכל תקין — שאל גבעה (32/016 "איזה גבעה")
  return res.send('read=f-32/016=NEIGHBORHOOD,,1,1,1,Number,yes,yes,,,,Ok,,,,no,');
});

// ────────────────────────────────────────────────
// שלב 2: קיבלנו גבעה — שאל תחנה
// ימות שולחת: ApiPhone, RIDE, SEATS, NEIGHBORHOOD (1 או 2)
// File mode: ימות מנגן קובץ מתוך תיקייה ששמה כשם הפרמטר
// שם פרמטר שונה לכל גבעה (ASTATION / BSTATION)
// ────────────────────────────────────────────────
router.get('/neighborhood', (req, res) => {
  const { NEIGHBORHOOD } = req.query;

  if (!NEIGHBORHOOD) {
    return res.send('id_list_message=f-32/006');
  }

  if (NEIGHBORHOOD === '1') {
    // גבעה A — משמיע 32/014, מקבל תחנה מתוך תיקיית ASTATION
    return res.send('read=f-32/014=ASTATION,,2,1,2,File,yes,yes,,,,Ok,,,,no,');
  } else {
    // גבעה B — משמיע 32/015, מקבל תחנה מתוך תיקיית BSTATION
    return res.send('read=f-32/015=BSTATION,,2,1,2,File,yes,yes,,,,Ok,,,,no,');
  }
});

// ────────────────────────────────────────────────
// שלב 3: קיבלנו תחנה — שמור הזמנה
// ימות שולחת: ApiPhone, RIDE, SEATS, ו-ASTATION או BSTATION
// שם הפרמטר מעיד גם על הגבעה
// ────────────────────────────────────────────────
router.get('/station', async (req, res) => {
  const { ApiPhone, RIDE, SEATS, ASTATION, BSTATION, ApiTime } = req.query;

  // קביעת גבעה ותחנה לפי איזה פרמטר הגיע
  let neighborhood, station;
  if (ASTATION) {
    neighborhood = 'A';
    station = parseInt(ASTATION);
  } else if (BSTATION) {
    neighborhood = 'B';
    station = parseInt(BSTATION);
  } else {
    return res.send('id_list_message=f-32/006');
  }

  if (!ApiPhone || !RIDE || !SEATS) {
    return res.send('id_list_message=f-32/006');
  }

  const rideId = parseInt(RIDE);
  const seats = parseInt(SEATS);
  const date = todayIL(ApiTime);

  // בדיקת תקינות תחנה
  if (station < 1 || station > 12) {
    return res.send('id_list_message=f-32/006');
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
      return res.send('id_list_message=f-32/000');
    }

    // יצירת קוד אישור ייחודי
    const bookingCode = await generateBookingCode(client, date);

    // שמירת ההזמנה
    await client.query(
      `INSERT INTO shaare_revaha.bookings
         (phone, date, ride_id, neighborhood, station, seats_count, booking_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ApiPhone, date, rideId, neighborhood, station, seats, bookingCode]
    );

    await client.query('COMMIT');

    // 32/005 = "הזמנה נקלטה בהצלחה מספר הזמנה הוא" + הקראת המספר
    return res.send(`id_list_message=f-32/005.n-${bookingCode}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('booking error:', err.message);
    return res.send('id_list_message=f-32/006');
  } finally {
    client.release();
  }
});

// ────────────────────────────────────────────────
// ביטול שלב 1: קיבלנו קוד ביטול
// ימות שולחת: ApiPhone, CANCEL_CODE (4 ספרות)
// ────────────────────────────────────────────────
router.get('/cancel', async (req, res) => {
  const { ApiPhone, CANCEL_CODE, ApiTime } = req.query;

  if (!ApiPhone || !CANCEL_CODE) {
    return res.send('id_list_message=f-32/006');
  }

  const code = String(CANCEL_CODE).padStart(4, '0');
  const date = todayIL(ApiTime);

  // חיפוש ההזמנה לפי קוד ההזמנה
  const find = await pool.query(
    `SELECT id, ride_id
     FROM shaare_revaha.bookings
     WHERE phone = $1
       AND date = $2
       AND status = 'active'
       AND booking_code = $3`,
    [ApiPhone, date, code]
  );

  if (find.rows.length === 0) {
    // לא נמצאה הזמנה — אין קובץ ייעודי, משתמש ב-011 "לא נמצאו נסיעות"
    return res.send('id_list_message=f-32/011');
  }

  const booking = find.rows[0];
  const ride = RIDES.find(r => r.id === booking.ride_id);

  // בדיקת חלון ביטול
  if (!canCancel(ride.departure_time, ApiTime)) {
    return res.send('id_list_message=f-32/007');
  }

  // ביטול
  await pool.query(
    `UPDATE shaare_revaha.bookings
     SET status = 'cancelled', cancelled_at = NOW()
     WHERE id = $1`,
    [booking.id]
  );

  // 32/013 = "ההזמנה נמחקה בהצלחה"
  return res.send('id_list_message=f-32/013');
});

module.exports = router;
