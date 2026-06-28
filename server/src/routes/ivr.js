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
  const { ApiPhone, RIDE, SEATS, NEIGHBORHOOD, ASTATION, BSTATION, ApiTime } = req.query;

  // ── ולידציה בסיסית ──
  if (!ApiPhone || !RIDE || !SEATS) {
    return res.send('id_list_message=f-/32/006');
  }

  const rideId = parseInt(RIDE);
  const seats = parseInt(SEATS);
  const date = todayIL(ApiTime);

  const ride = RIDES.find(r => r.id === rideId);
  if (!ride) {
    return res.send('id_list_message=f-/32/006');
  }

  // ════════════════════════════════════════════
  // שלב 3: כבר יש תחנה → שמור הזמנה
  // ════════════════════════════════════════════
  if (ASTATION || BSTATION) {
    const neighborhood = ASTATION ? 'A' : 'B';
    const station = parseInt(ASTATION || BSTATION);

    if (station < 1 || station > 12) {
      return res.send('id_list_message=f-/32/006');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // נעילת מרוץ לפי יום+נסיעה
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
        return res.send('id_list_message=f-/32/000');
      }

      const bookingCode = await generateBookingCode(client, date);

      await client.query(
        `INSERT INTO shaare_revaha.bookings
           (phone, date, ride_id, neighborhood, station, seats_count, booking_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ApiPhone, date, rideId, neighborhood, station, seats, bookingCode]
      );

      await client.query('COMMIT');

      // 32/005 = "הזמנה נקלטה בהצלחה מספר הזמנה הוא" + הקראת הקוד
      return res.send(`id_list_message=f-/32/005.n-${bookingCode}`);

    } catch (err) {
      await client.query('ROLLBACK');
      console.error('booking error:', err.message);
      return res.send('id_list_message=f-/32/006');
    } finally {
      client.release();
    }
  }

  // ════════════════════════════════════════════
  // שלב 2: יש גבעה → שאל תחנה
  // ════════════════════════════════════════════
  if (NEIGHBORHOOD) {
    if (NEIGHBORHOOD === '1') {
      // הקשה 1 = גבעה B — קובץ 32/015, תחנה מתיקיית BSTATION
      return res.send('read=f-/32/015=BSTATION,,2,1,2,File,yes,yes,,,,Ok,,,,no,');
    } else {
      // הקשה 2 = גבעה A — קובץ 32/014, תחנה מתיקיית ASTATION
      return res.send('read=f-/32/014=ASTATION,,2,1,2,File,yes,yes,,,,Ok,,,,no,');
    }
  }

  // ════════════════════════════════════════════
  // שלב 1: רק RIDE + SEATS → בדוק זמינות, שאל גבעה
  // ════════════════════════════════════════════

  // בדיקת חלון הזמן (מדלגים במצב טסט)
  const window = ride.direction === 'beitar_hadassah'
    ? BOOKING_WINDOW_BEITAR
    : BOOKING_WINDOW_HADASSAH;

  if (process.env.TEST_MODE !== 'on' && !canBook(ride.departure_time, window, ApiTime)) {
    // 32/008 = "ניתן להזמין מביתר שעה וחצי ומהדסה שעה"
    return res.send('id_list_message=f-/32/008');
  }

  // זמינות בנסיעה ומגבלת טלפון
  const taken = await takenSeats(rideId, date);
  const rideAvailable = TOTAL_SEATS - taken;
  const phoneBooked = await seatsForPhone(ApiPhone, rideId, date);
  const phoneRemaining = MAX_SEATS_PER_PHONE - phoneBooked;
  const available = Math.min(rideAvailable, phoneRemaining);

  if (available <= 0) {
    // 32/000 = "הנסיעה מלאה"
    return res.send('id_list_message=f-/32/000');
  }

  if (available < seats) {
    // נשאר פחות — בקש כמות קטנה יותר (32/001 / 32/002)
    const file = available === 1 ? '32/001' : '32/002';
    return res.send(`read=f-/${file}=SEATS,,,,1,Number,yes,yes,,,,,,,,`);
  }

  // הכל תקין — שאל גבעה (32/016), File mode
  return res.send('read=f-/32/016=NEIGHBORHOOD,,1,1,1,File,yes,yes,,,,Ok,,,,no,');
});

// ────────────────────────────────────────────────
// ביטול שלב 1: קיבלנו קוד ביטול
// ימות שולחת: ApiPhone, CANCEL_CODE (4 ספרות)
// ────────────────────────────────────────────────
// ────────────────────────────────────────────────
// ביטול שלב 1: קיבלנו קוד — אמת שקיים ושאל אישור
// ימות שולחת: ApiPhone, CANCEL_CODE (4 ספרות)
// ────────────────────────────────────────────────
router.get('/cancel-find', async (req, res) => {
  const { ApiPhone, CANCEL_CODE, ApiTime } = req.query;

  if (!ApiPhone || !CANCEL_CODE) {
    return res.send('id_list_message=f-/32/006');
  }

  const code = String(CANCEL_CODE).padStart(4, '0');
  const date = todayIL(ApiTime);

  // חיפוש ההזמנה
  const find = await pool.query(
    `SELECT ride_id
     FROM shaare_revaha.bookings
     WHERE phone = $1 AND date = $2 AND status = 'active' AND booking_code = $3`,
    [ApiPhone, date, code]
  );

  if (find.rows.length === 0) {
    // לא נמצאה הזמנה — 32/011 "לא נמצאו נסיעות"
    return res.send('id_list_message=f-/32/011');
  }

  const ride = RIDES.find(r => r.id === find.rows[0].ride_id);

  // בדיקת חלון ביטול
  if (process.env.TEST_MODE !== 'on' && !canCancel(ride.departure_time, ApiTime)) {
    // מאוחר מדי — 32/007
    return res.send('id_list_message=f-/32/007');
  }

  // נמצאה ותקינה — שאל אישור (32/012 "למחיקה הקישו 1 לביטול וחזרה הקישו 2")
  return res.send('read=f-/32/012=CONFIRM,,1,1,1,Number,yes,yes,,,,Ok,,,,no,');
});

// ────────────────────────────────────────────────
// ביטול שלב 2: קיבלנו אישור — בצע מחיקה
// ימות שולחת: ApiPhone, CANCEL_CODE, CONFIRM (1=מחק, 2=ביטול)
// ────────────────────────────────────────────────
router.get('/cancel', async (req, res) => {
  const { ApiPhone, CANCEL_CODE, CONFIRM, ApiTime } = req.query;

  if (!ApiPhone || !CANCEL_CODE || !CONFIRM) {
    return res.send('id_list_message=f-/32/006');
  }

  // אם בחר 2 (ביטול וחזרה) — לא מוחקים, רק שלום
  if (CONFIRM !== '1') {
    return res.send('id_list_message=f-/32/004');
  }

  const code = String(CANCEL_CODE).padStart(4, '0');
  const date = todayIL(ApiTime);

  // חיפוש ההזמנה שוב (כולל בדיקת חלון מחדש)
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

  // ביצוע הביטול
  await pool.query(
    `UPDATE shaare_revaha.bookings
     SET status = 'cancelled', cancelled_at = NOW()
     WHERE id = $1`,
    [booking.id]
  );

  // 32/013 = "ההזמנה נמחקה בהצלחה"
  return res.send('id_list_message=f-/32/013');
});

module.exports = router;
