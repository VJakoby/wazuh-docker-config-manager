'use strict';

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const https   = require('https');

const client = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 10_000,
});

function baseURL() {
  return (process.env.WAZUH_API_URL || 'https://localhost:55000').replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// POST /api/auth/login   body: { username, password }
// ---------------------------------------------------------------------------

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  console.log(`[auth] Login attempt for user "${username}"`);

  try {
    const response = await client.get(`${baseURL()}/security/user/authenticate`, {
      auth: { username, password },
    });

    const token = response.data?.data?.token;
    if (!token) {
      console.log(`[auth] Login failed for "${username}" — no token in response`);
      return res.status(401).json({ error: 'Authentication failed — no token returned' });
    }

    // Store only the validated token in session.
    req.session.authenticated = true;
    req.session.username       = username;
    req.session.wazuhToken     = token;
    req.session.loginTime      = Date.now();

    req.session.save((saveErr) => {
      if (saveErr) {
        console.log(`[auth] Session save failed for "${username}" — ${saveErr.message}`);
        return res.status(500).json({ error: 'Could not persist login session' });
      }

      console.log(`[auth] Login successful for "${username}"`);
      res.json({ ok: true, username });
    });

  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.detail || err.message;

    console.log(`[auth] Login failed for "${username}" — status ${status}: ${detail}`);

    if (status === 401) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    return res.status(500).json({ error: `Wazuh API error: ${detail}` });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

router.post('/logout', (req, res) => {
  const username = req.session.username;
  req.session.destroy(() => {
    console.log(`[auth] User "${username}" logged out`);
    res.json({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me — returns current session info
// ---------------------------------------------------------------------------

router.get('/me', (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    username:  req.session.username,
    loginTime: req.session.loginTime,
  });
});

module.exports = router;
