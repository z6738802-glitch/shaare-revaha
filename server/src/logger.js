'use strict';

const pool = require('../db');

// יצירת טבלת הלוגים אם לא קיימת
async function ensureLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shaare_revaha.ivr_logs (
      id          BIGSERIAL PRIMARY KEY,
      endpoint    TEXT NOT NULL,
      phone       TEXT,
      query       JSONB,
      response    TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ivr_logs_created ON shaare_revaha.ivr_logs (created_at DESC);
  `);
}

// רישום קריאה
async function logCall(endpoint, query, response) {
  try {
    await pool.query(
      `INSERT INTO shaare_revaha.ivr_logs (endpoint, phone, query, response)
       VALUES ($1, $2, $3, $4)`,
      [endpoint, query.ApiPhone || null, JSON.stringify(query), response]
    );
  } catch (err) {
    console.error('log error:', err.message);
  }
}

// מחיקת לוגים ישנים מעל שבוע
async function cleanOldLogs() {
  try {
    await pool.query(
      `DELETE FROM shaare_revaha.ivr_logs WHERE created_at < NOW() - INTERVAL '7 days'`
    );
  } catch (err) {
    console.error('cleanup error:', err.message);
  }
}

// middleware שעוטף את res.send כדי לתעד את התגובה
function logMiddleware(req, res, next) {
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    // רישום אסינכרוני, לא חוסם את התגובה
    const endpoint = req.path;
    logCall(endpoint, req.query, body);
    return originalSend(body);
  };
  next();
}

module.exports = { ensureLogTable, logCall, cleanOldLogs, logMiddleware };
