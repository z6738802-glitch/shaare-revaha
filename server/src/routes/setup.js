'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../db');

// endpoint זמני להרצת המיגרציה
// יש למחוק אחרי שימוש!
router.get('/run-migration', async (req, res) => {
  const sql = `
    CREATE SCHEMA IF NOT EXISTS shaare_revaha;

    CREATE TABLE IF NOT EXISTS shaare_revaha.bookings (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone         TEXT NOT NULL,
      date          DATE NOT NULL,
      ride_id       SMALLINT NOT NULL CHECK (ride_id BETWEEN 1 AND 8),
      neighborhood  CHAR(1) NOT NULL CHECK (neighborhood IN ('A','B')),
      station       SMALLINT NOT NULL CHECK (station BETWEEN 1 AND 12),
      seats_count   SMALLINT NOT NULL DEFAULT 1 CHECK (seats_count BETWEEN 1 AND 3),
      status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cancelled_at  TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_date_ride_status ON shaare_revaha.bookings (date, ride_id, status);
    CREATE INDEX IF NOT EXISTS idx_bookings_phone_date ON shaare_revaha.bookings (phone, date);
    CREATE INDEX IF NOT EXISTS idx_bookings_date ON shaare_revaha.bookings (date);
  `;

  try {
    await pool.query(sql);
    res.json({ success: true, message: 'migration completed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// בדיקת חיבור DB
router.get('/db-check', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as time, current_database() as db');
    res.json({ success: true, ...result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
