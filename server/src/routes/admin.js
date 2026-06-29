'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { RIDES, STATIONS_A, STATIONS_B } = require('../data');
const { todayIL } = require('../time');

// ────────────────────────────────────────────────
// POST /admin/login — אימות סיסמת נהג
// ────────────────────────────────────────────────
router.post('/login', express.json(), (req, res) => {
  const { password } = req.body || {};
  const correct = process.env.DRIVER_PASSWORD || 'changeme';
  if (password && password === correct) {
    res.json({ success: true, token: correct });
  } else {
    res.status(401).json({ success: false });
  }
});

// בדיקת token (header) — middleware
function requireAuth(req, res, next) {
  const token = req.headers['x-auth'] || req.query.token;
  const correct = process.env.DRIVER_PASSWORD || 'changeme';
  if (token === correct) return next();
  res.status(401).json({ error: 'unauthorized' });
}

// עזר: שם נסיעה לפי id
function rideLabel(rideId) {
  const ride = RIDES.find(r => r.id === rideId);
  return ride ? ride.label : `נסיעה ${rideId}`;
}

// עזר: שם תחנה לפי גבעה ומספר
function stationName(neighborhood, stationId) {
  // נסיעות הדסה→ביתר — אין גבעה/תחנה
  if (!neighborhood || !stationId) return 'איסוף מהדסה';
  const list = neighborhood === 'A' ? STATIONS_A : STATIONS_B;
  const s = list.find(s => s.id === stationId);
  return s ? s.name : `תחנה ${stationId}`;
}

// ────────────────────────────────────────────────
// GET /admin/driver — תצוגת נהג: כל הנסיעות של היום + נוסעים
// ────────────────────────────────────────────────
router.get('/driver', requireAuth, async (req, res) => {
  const date = req.query.date || todayIL();

  try {
    const result = await pool.query(
      `SELECT ride_id, neighborhood, station, phone, seats_count, booking_code, created_at
       FROM shaare_revaha.bookings
       WHERE date = $1 AND status = 'active'
       ORDER BY ride_id ASC, created_at ASC`,
      [date]
    );

    // קבץ לפי נסיעה
    const ridesMap = {};
    RIDES.forEach(ride => {
      ridesMap[ride.id] = {
        id: ride.id,
        label: ride.label,
        direction: ride.direction,
        departure_time: ride.departure_time,
        seats_taken: 0,
        passengers: [],
      };
    });

    result.rows.forEach(b => {
      const r = ridesMap[b.ride_id];
      if (!r) return;
      r.seats_taken += b.seats_count;
      r.passengers.push({
        phone: b.phone,
        neighborhood: b.neighborhood,
        station: b.station,
        station_name: stationName(b.neighborhood, b.station),
        seats_count: b.seats_count,
        booking_code: b.booking_code,
      });
    });

    res.json({ date, rides: Object.values(ridesMap) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});


router.get('/rides', async (req, res) => {
  const date = req.query.date || todayIL();

  try {
    const result = await pool.query(
      `SELECT
         ride_id,
         COUNT(*) FILTER (WHERE status = 'active') AS bookings_count,
         COALESCE(SUM(seats_count) FILTER (WHERE status = 'active'), 0) AS seats_taken
       FROM shaare_revaha.bookings
       WHERE date = $1
       GROUP BY ride_id
       ORDER BY ride_id`,
      [date]
    );

    // בנה תגובה עם כל 8 הנסיעות
    const ridesMap = {};
    result.rows.forEach(r => {
      ridesMap[r.ride_id] = {
        bookings: parseInt(r.bookings_count),
        seats_taken: parseInt(r.seats_taken),
      };
    });

    const rides = RIDES.map(ride => ({
      id: ride.id,
      label: ride.label,
      direction: ride.direction,
      departure_time: ride.departure_time,
      seats_taken: ridesMap[ride.id]?.seats_taken || 0,
      seats_available: 16 - (ridesMap[ride.id]?.seats_taken || 0),
      bookings_count: ridesMap[ride.id]?.bookings || 0,
    }));

    res.json({ date, rides });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// ────────────────────────────────────────────────
// GET /admin/bookings?date=YYYY-MM-DD&ride_id=1
// כל ההזמנות לנסיעה מסוימת
// ────────────────────────────────────────────────
router.get('/bookings', async (req, res) => {
  const date = req.query.date || todayIL();
  const { ride_id } = req.query;

  try {
    let query = `
      SELECT id, phone, ride_id, neighborhood, station, seats_count, status, created_at, cancelled_at
      FROM shaare_revaha.bookings
      WHERE date = $1`;
    const params = [date];

    if (ride_id) {
      query += ` AND ride_id = $2`;
      params.push(parseInt(ride_id));
    }

    query += ` ORDER BY created_at ASC`;

    const result = await pool.query(query, params);

    const bookings = result.rows.map(b => ({
      ...b,
      ride_label: rideLabel(b.ride_id),
      station_name: stationName(b.neighborhood, b.station),
      short_id: b.id.replace(/-/g, '').slice(-4).toUpperCase(),
    }));

    res.json({ date, bookings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// ────────────────────────────────────────────────
// GET /admin/history?from=YYYY-MM-DD&to=YYYY-MM-DD
// היסטוריה לתאריך רוחב
// ────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  const from = req.query.from || todayIL();
  const to = req.query.to || todayIL();

  try {
    const result = await pool.query(
      `SELECT
         date,
         ride_id,
         COUNT(*) FILTER (WHERE status = 'active') AS active_bookings,
         COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_bookings,
         COALESCE(SUM(seats_count) FILTER (WHERE status = 'active'), 0) AS seats_taken
       FROM shaare_revaha.bookings
       WHERE date BETWEEN $1 AND $2
       GROUP BY date, ride_id
       ORDER BY date DESC, ride_id ASC`,
      [from, to]
    );

    const rows = result.rows.map(r => ({
      ...r,
      ride_label: rideLabel(r.ride_id),
      active_bookings: parseInt(r.active_bookings),
      cancelled_bookings: parseInt(r.cancelled_bookings),
      seats_taken: parseInt(r.seats_taken),
    }));

    res.json({ from, to, rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;
