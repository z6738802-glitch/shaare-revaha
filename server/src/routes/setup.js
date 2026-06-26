'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../db');

// endpoint זמני להוספת עמודת booking_code — למחוק אחרי שימוש!
router.get('/add-booking-code', async (req, res) => {
  try {
    // אם יש כבר שורות בלי קוד, נמחק אותן (היו בדיקות בלבד)
    await pool.query(`DELETE FROM shaare_revaha.bookings WHERE booking_code IS NULL`).catch(() => {});

    await pool.query(`
      ALTER TABLE shaare_revaha.bookings
        ADD COLUMN IF NOT EXISTS booking_code CHAR(4)
    `);

    // מילוי שורות קיימות בקוד זמני (אם יש)
    await pool.query(`
      UPDATE shaare_revaha.bookings
      SET booking_code = LPAD((1000 + (random() * 8999)::int)::text, 4, '0')
      WHERE booking_code IS NULL
    `);

    // הפיכת העמודה ל-NOT NULL
    await pool.query(`
      ALTER TABLE shaare_revaha.bookings
        ALTER COLUMN booking_code SET NOT NULL
    `);

    // אינדקס ייחודי לכל יום
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_date_code
        ON shaare_revaha.bookings (date, booking_code)
    `);

    res.json({ success: true, message: 'booking_code column added' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
