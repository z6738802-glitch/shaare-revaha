'use strict';

const express = require('express');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// routes
const ivrRouter = require('./routes/ivr');
const adminRouter = require('./routes/admin');

app.use('/ivr', ivrRouter);
app.use('/admin', adminRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`shaare-revaha server running on port ${PORT}`);
});
