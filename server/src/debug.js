'use strict';

const express = require('express');
const router = express.Router();
const pool = require('./db');

// endpoint זמני לבדיקה — מראה הזמנות היום לפי נסיעה
router.get('/debug-bookings', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ride_id, phone, neighborhood, station, seats_count, booking_code, status, created_at
      FROM shaare_revaha.bookings
      WHERE date = CURRENT_DATE
      ORDER BY ride_id, created_at
    `);
    const summary = await pool.query(`
      SELECT ride_id,
             SUM(seats_count) FILTER (WHERE status='active') AS active_seats,
             COUNT(*) FILTER (WHERE status='active') AS active_count,
             COUNT(*) FILTER (WHERE status='cancelled') AS cancelled_count
      FROM shaare_revaha.bookings
      WHERE date = CURRENT_DATE
      GROUP BY ride_id ORDER BY ride_id
    `);
    res.json({ summary: summary.rows, all: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// בדיקת חיפוש ביטול — מראה מה ה-date המאוחסן מול מה שמחפשים
router.get('/debug-cancel', async (req, res) => {
  const { phone, code } = req.query;
  try {
    const found = await pool.query(
      `SELECT id, date::text AS stored_date, phone, booking_code, status
       FROM shaare_revaha.bookings
       WHERE phone = $1 AND booking_code = $2`,
      [phone, code]
    );
    const today = await pool.query(`SELECT CURRENT_DATE::text AS server_date`);
    res.json({
      server_current_date: today.rows[0].server_date,
      search_phone: phone,
      search_code: code,
      all_matches_ignoring_date: found.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// בדיקת מה todayIL מחזיר על השרת
router.get('/debug-today', async (req, res) => {
  const { todayIL } = require('./time');
  res.json({
    todayIL_no_args: todayIL(),
    raw_date: new Date().toISOString(),
    locale_il: new Date().toLocaleString('en-CA', { timeZone: 'Asia/Jerusalem' }),
  });
});

module.exports = router;