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

module.exports = router;
