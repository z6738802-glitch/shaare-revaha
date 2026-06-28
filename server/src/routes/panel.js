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

// GET /panel/call/:phone — כל הקריאות של שיחה אחת (לפי טלפון, אחרונות)
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
