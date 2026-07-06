'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../db');
const {
  RIDES,
  STATIONS_A,
  STATIONS_B,
  TOTAL_SEATS,
  BOOKING_OPEN_BEITAR,
  BOOKING_OPEN_HADASSAH,
  BOOKING_CLOSE,
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

// ════════════════════════════════════════════════
// /book — endpoint מאוחד לכל שלבי ההזמנה
// ב-ימות כל read חוזר לאותו api_link, אז מנהלים את
// כל ה-flow לפי הפרמטרים שכבר הצטברו בשיחה.
//
// שלבים:
//   1. RIDE + SEATS בלבד          → בדיקת זמינות → שאל גבעה
//   2. + NEIGHBORHOOD              → שאל תחנה (לפי גבעה)
//   3. + ASTATION / BSTATION       → שמור הזמנה
// ════════════════════════════════════════════════
router.get('/book', async (req, res) => {
  const { ApiPhone, RIDE, SEATS, DIRECTION, NEIGHBORHOOD, ASTATION, BSTATION, ApiTime } = req.query;

  // ── ולידציה בסיסית ──
  if (!ApiPhone || !RIDE || !SEATS) {
    return res.send('id_list_message=f-/32/006');
  }

  // ── המרת RIDE לפי כיוון ──
  // אם הגיע DIRECTION=hadassah, RIDE 1-4 ממופה ל-5-8
  // אחרת (beitar או ללא DIRECTION) נשאר 1-4
  let rideId = parseInt(RIDE);
  let direction = 'beitar_hadassah';
  if (DIRECTION === 'hadassah') {
    direction = 'hadassah_beitar';
    rideId = rideId + 4; // 1→5, 2→6, 3→7, 4→8
  }

  const seats = parseInt(SEATS);
  const date = todayIL(ApiTime);

  const ride = RIDES.find(r => r.id === rideId);
  if (!ride) {
    return res.send('id_list_message=f-/32/006');
  }

  const isHadassah = ride.direction === 'hadassah_beitar';

  // ════════════════════════════════════════════
  // שמירת הזמנה — מתי?
  //   ביתר→הדסה: כשיש תחנה (ASTATION/BSTATION)
  //   הדסה→ביתר: מיד אחרי בדיקת זמינות (אין תחנה)
  // ════════════════════════════════════════════
  const hasStation = ASTATION || BSTATION;

  async function saveBooking(neighborhood, station) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const dateKey = parseInt(date.slice(8, 10) + date.slice(5, 7) + date.slice(2, 4));
      const lockKey = rideId * 1000000 + dateKey;
      await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

      const check = await client.query(
        `SELECT COALESCE(SUM(seats_count), 0) AS taken
         FROM shaare_revaha.bookings
         WHERE date = $1 AND ride_id = $2 AND status = 'active'`,
        [date, rideId]
      );
      const taken = parseInt(check.rows[0].taken);

      if (TOTAL_SEATS - taken < seats) {
        await client.query('ROLLBACK');
        return 'id_list_message=f-/32/000';
      }

      const bookingCode = await generateBookingCode(client, date);

      await client.query(
        `INSERT INTO shaare_revaha.bookings
           (phone, date, ride_id, neighborhood, station, seats_count, booking_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ApiPhone, date, rideId, neighborhood, station, seats, bookingCode]
      );

      await client.query('COMMIT');
      return `id_list_message=f-/32/005.n-${bookingCode}`;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('booking error:', err.message);
      return 'id_list_message=f-/32/006';
    } finally {
      client.release();
    }
  }

  // ── ביתר→הדסה: יש תחנה → שמור ──
  if (hasStation) {
    const neighborhood = ASTATION ? 'A' : 'B';
    const station = parseInt(ASTATION || BSTATION);
    if (station < 1 || station > 12) {
      return res.send('id_list_message=f-/32/006');
    }
    return res.send(await saveBooking(neighborhood, station));
  }

  // ── ביתר→הדסה: יש גבעה → שאל תחנה ──
  if (NEIGHBORHOOD && !isHadassah) {
    if (NEIGHBORHOOD === '1') {
      return res.send('read=f-/32/015=BSTATION,,2,1,2,File,yes,yes,,,,Ok,,,,no,');
    } else {
      return res.send('read=f-/32/014=ASTATION,,2,1,2,File,yes,yes,,,,Ok,,,,no,');
    }
  }

  // ════════════════════════════════════════════
  // שלב 1: רק RIDE + SEATS → בדוק זמינות
  // ════════════════════════════════════════════

  // בדיקת חלון הזמן
  const openWindow = isHadassah ? BOOKING_OPEN_HADASSAH : BOOKING_OPEN_BEITAR;

  if (process.env.TEST_MODE !== 'on' && !canBook(ride.departure_time, openWindow, BOOKING_CLOSE, ApiTime)) {
    return res.send('id_list_message=f-/32/008');
  }

  // זמינות + מגבלת טלפון
  const taken = await takenSeats(rideId, date);
  const rideAvailable = TOTAL_SEATS - taken;
  const phoneBooked = await seatsForPhone(ApiPhone, rideId, date);
  const phoneRemaining = MAX_SEATS_PER_PHONE - phoneBooked;
  const available = Math.min(rideAvailable, phoneRemaining);

  if (available <= 0) {
    return res.send('id_list_message=f-/32/000');
  }

  if (available < seats) {
    const file = available === 1 ? '32/001' : '32/002';
    return res.send(`read=f-/${file}=SEATS,,,,1,Number,yes,yes,,,,,,,,`);
  }

  // ── הדסה→ביתר: אין גבעה/תחנה → שמור מיד ──
  if (isHadassah) {
    return res.send(await saveBooking(null, null));
  }

  // ── ביתר→הדסה: שאל גבעה ──
  return res.send('read=f-/32/016=NEIGHBORHOOD,,1,1,1,File,yes,yes,,,,Ok,,,,no,');
});

// ────────────────────────────────────────────────
// ביטול שלב 1: קיבלנו קוד ביטול
// ימות שולחת: ApiPhone, CANCEL_CODE (4 ספרות)
// ════════════════════════════════════════════════
// /cancel — endpoint מאוחד לביטול (דו-שלבי)
// ב-ימות ה-read חוזר לאותו api_link, אז:
//   1. רק CANCEL_CODE          → אמת קוד → שאל אישור (32/012)
//   2. + CONFIRM (1=מחק/2=לא)  → בצע ביטול או חזרה
// ════════════════════════════════════════════════
router.get('/cancel', async (req, res) => {
  const { ApiPhone, CANCEL_CODE, CONFIRM, ApiTime } = req.query;

  if (!ApiPhone || !CANCEL_CODE) {
    return res.send('id_list_message=f-/32/006');
  }

  const code = String(CANCEL_CODE).padStart(4, '0');
  const date = todayIL(ApiTime);

  // ── שלב 2: יש אישור ──
  if (CONFIRM) {
    // בחר 2 (ביטול וחזרה) — לא מוחקים
    if (CONFIRM !== '1') {
      return res.send('id_list_message=f-/32/004');
    }

    const find = await pool.query(
      `SELECT id, ride_id
       FROM shaare_revaha.bookings
       WHERE phone = $1 AND date = $2 AND status = 'active' AND booking_code = $3`,
      [ApiPhone, date, code]
    );

    if (find.rows.length === 0) {
      return res.send('id_list_message=f-/32/011');
    }

    const booking = find.rows[0];
    const ride = RIDES.find(r => r.id === booking.ride_id);

    if (process.env.TEST_MODE !== 'on' && !canCancel(ride.departure_time, ApiTime)) {
      return res.send('id_list_message=f-/32/007');
    }

    await pool.query(
      `UPDATE shaare_revaha.bookings
       SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = $1`,
      [booking.id]
    );

    // 32/013 = "ההזמנה נמחקה בהצלחה"
    return res.send('id_list_message=f-/32/013');
  }

  // ── שלב 1: רק קוד — אמת ושאל אישור ──
  const find = await pool.query(
    `SELECT ride_id
     FROM shaare_revaha.bookings
     WHERE phone = $1 AND date = $2 AND status = 'active' AND booking_code = $3`,
    [ApiPhone, date, code]
  );

  if (find.rows.length === 0) {
    // 32/011 = "לא נמצאו נסיעות"
    return res.send('id_list_message=f-/32/011');
  }

  const ride = RIDES.find(r => r.id === find.rows[0].ride_id);

  if (process.env.TEST_MODE !== 'on' && !canCancel(ride.departure_time, ApiTime)) {
    // 32/007 = "ההזמנה נסגרה לשעה זו"
    return res.send('id_list_message=f-/32/007');
  }

  // 32/012 = "למחיקה הקישו 1 לביטול וחזרה הקישו 2"
  // ערך 6 = No (לא משמיע את ההקשה), ערך 15 = no (לא מבקש אישור)
  return res.send('read=f-/32/012=CONFIRM,,1,1,1,No,yes,yes,,,,no,,,,no,');
});

module.exports = router;
