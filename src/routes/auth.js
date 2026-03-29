'use strict';

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const https   = require('https');
const util    = require('util');
const { getWazuhApiURL, resolveWazuhApiURL } = require('../wazuh-url');

const client = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 10_000,
});

function baseURL() {
  return getWazuhApiURL();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function formatAxiosError(err, url) {
  const status = err.response?.status;
  const data = err.response?.data;

  const responseDetail = firstNonEmpty(
    data?.detail,
    data?.message,
    data?.error,
    typeof data === 'string' ? data : ''
  );
  if (responseDetail) return { status, detail: responseDetail };

  const parts = [];
  const code = firstNonEmpty(err?.code);
  const errno = firstNonEmpty(String(err?.errno ?? ''));
  const address = firstNonEmpty(err?.address);
  const port = err?.port != null ? String(err.port) : '';
  const message = firstNonEmpty(err?.message, err?.cause?.message);

  if (code) parts.push(`code ${code}`);
  if (errno) parts.push(`errno ${errno}`);
  if (address) parts.push(`address ${address}`);
  if (port) parts.push(`port ${port}`);
  if (message) parts.push(message);

  const axiosJson = typeof err?.toJSON === 'function' ? err.toJSON() : null;
  const rawSummary = firstNonEmpty(
    axiosJson ? util.inspect(axiosJson, { breakLength: Infinity, compact: true }) : '',
    util.inspect(err, { breakLength: Infinity, compact: true })
  );
  if (rawSummary) parts.push(`raw ${rawSummary}`);

  const detail = parts.length
    ? parts.join(' | ')
    : `No response from Wazuh API at ${url}`;

  return { status, detail };
}

// ---------------------------------------------------------------------------
// POST /api/auth/login   body: { username, password }
// ---------------------------------------------------------------------------

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const url = `${baseURL()}/security/user/authenticate`;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  console.log(`[auth] Login attempt for user "${username}"`);

  try {
    const response = await client.get(url, {
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
    const { status, detail } = formatAxiosError(err, url);

    console.log(`[auth] Login failed for "${username}" — status ${status ?? 'no-response'}: ${detail}`);

    if (status === 401) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const resolution = resolveWazuhApiURL();
    const hint = /localhost|127\.0\.0\.1/.test(resolution.raw)
      ? ' If this app runs in Docker, do not use localhost for WAZUH_API_URL. Use the Wazuh container/service name on the shared Docker network instead.'
      : '';

    return res.status(500).json({ error: `Wazuh API error: ${detail}${hint}` });
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
