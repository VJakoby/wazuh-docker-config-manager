'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');

const rulesRouter  = require('./src/routes/rules');
const agentsRouter = require('./src/routes/agents');
const configRouter = require('./src/routes/config');
const backupRouter = require('./src/routes/backup');

const app  = express();
const PORT = process.env.PORT || 8080;

// ---------------------------------------------------------------------------
// Request logger
// ---------------------------------------------------------------------------

app.use((req, res, next) => {
  // Only log API requests to keep output clean
  if (!req.path.startsWith('/api')) return next();

  const start = Date.now();
  res.on('finish', () => {
    const ms     = Date.now() - start;
    const status = res.statusCode;
    const color  = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m';
    const reset  = '\x1b[0m';
    console.log(`${color}${status}${reset} ${req.method} ${req.path} ${ms}ms`);
  });

  next();
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.use('/api/rules',    rulesRouter);
app.use('/api/decoders', rulesRouter);  // same router, path tells it which dir
app.use('/api/agents',   agentsRouter);
app.use('/api/config',   configRouter);
app.use('/api/backup',   backupRouter);

// Health check
app.get('/api/health', async (req, res) => {
  const docker = require('./src/docker');
  try {
    const info = await docker.containerInfo();
    res.json({ ok: true, container: info });
  } catch (err) {
    console.error('[health] Docker error:', err.message);
    res.status(503).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Console link — returns the host's local IP and Wazuh dashboard URL
// ---------------------------------------------------------------------------

app.get('/api/health/console', (req, res) => {
  const os      = require('os');
  const nets    = os.networkInterfaces();
  const apiURL  = process.env.WAZUH_API_URL || 'https://localhost:55000';

  // Pick the first non-internal IPv4 address
  let hostIP = 'localhost';
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        hostIP = iface.address;
        break;
      }
    }
    if (hostIP !== 'localhost') break;
  }

  // Dashboard is on port 443 by default in the single-node Docker setup
  const dashboardPort = process.env.WAZUH_DASHBOARD_PORT || '443';
  const dashboardURL  = `https://${hostIP}:${dashboardPort}`;

  res.json({ hostIP, dashboardURL, apiURL });
});

// ---------------------------------------------------------------------------
// SPA fallback
// ---------------------------------------------------------------------------

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

app.use((err, req, res, _next) => {
  console.error('[express] Unhandled error:', err);
  res.status(500).json({ error: err.message });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\nwazuh-web-manager running at http://localhost:${PORT}`);
  console.log(`  Container : ${process.env.WAZUH_CONTAINER || '(auto-discover)'}`);
  console.log(`  API URL   : ${process.env.WAZUH_API_URL   || 'https://localhost:55000'}`);
  console.log(`  API user  : ${process.env.WAZUH_API_USER  || 'wazuh (default)'}`);
  console.log(`  Log level : verbose\n`);
});
