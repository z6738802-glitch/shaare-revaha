'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../db');

// אימות סיסמת פאנל (נפרדת מסיסמת הנהג)
function requirePanelAuth(req, res, next) {
  const token = req.headers['x-auth'] || req.query.token;
  const correct = process.env.PANEL_PASSWORD || 'devpanel';
  if (token === correct) return next();
  res.status(401).json({ error: 'unauthorized' });
}

// POST /panel/login
router.post('/login', express.json(), (req, res) => {
  const { password } = req.body || {};
  const correct = process.env.PANEL_PASSWORD || 'devpanel';
  if (password && password === correct) {
    res.json({ success: true, token: correct });
  } else {
    res.status(401).json({ success: false });
  }
});

// GET /panel/logs — רשימת הקריאות האחרונות
router.get('/logs', requirePanelAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  try {
    const result = await pool.query(
      `SELECT id, endpoint, phone, query, response, created_at
       FROM shaare_revaha.ivr_logs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ logs: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// GET /panel/sessions — קריאות מקובצות לפי שיחה (call_id)
router.get('/sessions', requirePanelAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 300);
  try {
    // שלוף את כל הלוגים האחרונים
    const result = await pool.query(
      `SELECT id, call_id, endpoint, phone, query, response, created_at
       FROM shaare_revaha.ivr_logs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    // קבץ לפי call_id (קריאות ללא call_id — כל אחת לבד)
    const sessionsMap = new Map();
    for (const row of result.rows) {
      const key = row.call_id || `single_${row.id}`;
      if (!sessionsMap.has(key)) {
        sessionsMap.set(key, {
          call_id: row.call_id,
          phone: row.phone,
          steps: [],
          first_at: row.created_at,
          last_at: row.created_at,
        });
      }
      const s = sessionsMap.get(key);
      s.steps.push({
        id: row.id,
        endpoint: row.endpoint,
        query: row.query,
        response: row.response,
        created_at: row.created_at,
      });
      // עדכון זמנים (הרשומות יורדות, אז first מתעדכן לאחרונה שנראתה)
      if (row.created_at < s.first_at) s.first_at = row.created_at;
      if (row.created_at > s.last_at) s.last_at = row.created_at;
      if (!s.phone && row.phone) s.phone = row.phone;
    }

    // הפוך כל סשן לסדר כרונולוגי (שלב ראשון קודם)
    const sessions = Array.from(sessionsMap.values()).map(s => {
      s.steps.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      return s;
    });
    // מיין סשנים לפי הזמן האחרון (החדש למעלה)
    sessions.sort((a, b) => new Date(b.last_at) - new Date(a.last_at));

    res.json({ sessions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});


router.get('/call', requirePanelAuth, async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  try {
    const result = await pool.query(
      `SELECT id, endpoint, phone, query, response, created_at
       FROM shaare_revaha.ivr_logs
       WHERE phone = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [phone]
    );
    res.json({ logs: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// GET /panel — דף הפאנל
const path = require('path');
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'dashboard', 'panel.html'));
});

module.exports = router;
