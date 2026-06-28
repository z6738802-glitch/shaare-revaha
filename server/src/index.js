'use strict';

const express = require('express');
const path = require('path');
const app = express();

const { ensureLogTable, cleanOldLogs, logMiddleware } = require('./logger');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// דשבורד סטטי
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

// routes
const ivrRouter = require('./routes/ivr');
const adminRouter = require('./routes/admin');
const panelRouter = require('./routes/panel');

// תיעוד כל קריאות ה-IVR
app.use('/ivr', logMiddleware, ivrRouter);
app.use('/admin', adminRouter);
app.use('/panel', panelRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;

// הקמת טבלת לוגים ותזמון ניקוי יומי
ensureLogTable().then(() => {
  console.log('ivr_logs table ready');
  cleanOldLogs();
  setInterval(cleanOldLogs, 24 * 60 * 60 * 1000); // כל 24 שעות
}).catch(e => console.error('log table init error:', e.message));

app.listen(PORT, () => {
  console.log(`shaare-revaha server running on port ${PORT}`);
});
