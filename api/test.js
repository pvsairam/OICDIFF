const express = require('express');
const app = express();

app.get('/api/test', (req, res) => {
  res.json({ 
    status: 'ok', 
    env: {
      hasDbUrl: !!process.env.DATABASE_URL,
      hasNeonUrl: !!process.env.NEON_DATABASE_URL,
      nodeEnv: process.env.NODE_ENV
    }
  });
});

module.exports = app;
