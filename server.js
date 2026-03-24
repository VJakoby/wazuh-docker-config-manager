'use strict';

require('dotenv').config();

const express     = require('express');
const path        = require('path');
const session     = require('express-session');
const requireAuth = require('./src/middleware/auth');

const rulesRouter  = require('./src/routes/rules');
const agentsRouter = require('./src/routes/agents');
const configRouter = require('./src/routes/config');
const backupRouter = require('./src/routes/backup');
const authRouter       = require('./src/routes/auth');
const historyRouter    = require('./src/routes/history');
const listsRouter      = require('./src/routes/lists');
const containersRouter = require('./src/routes/containers');
const conflictsRouter  = require('./src/routes/conflicts');

const app  = express();
const PORT = process.env.PORT || 8080;
const sessionSecret = process.env.SESSION_SECRET;

if (process.env.NODE_ENV === 'production' && (!sessionSecret || sessionSecret === 'change-me-to-a-random-string')) {
  throw new Error('SESSION_SECRET must be set to a non-default value in production');
}

if (process.env.COOKIE_SECURE === 'true') {
  app.set('trust proxy', 1);
}

// ---------------------------------------------------------------------------
// Request logger
// ---------------------------------------------------------------------------

app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  const start = Date.now();
  res.on('finish', () => {
    const ms    = Date.now() - start;
    const s     = res.statusCode;
    const color = s >= 500 ? '\x1b[31m' : s >= 400 ? '\x1b[33m' : '\x1b[32m';
    console.log(`${color}${s}\x1b[0m ${req.method} ${req.path} ${ms}ms`);
  });
  next();
});

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const sessionMiddleware = session({
  secret:            sessionSecret || 'dev-only-session-secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge:   8 * 60 * 60 * 1000,
    sameSite: 'strict',
    secure:   process.env.COOKIE_SECURE === 'true',
  },
});

app.use(sessionMiddleware);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(express.json({ limit: '2mb' }));
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use('/api/auth',     authRouter);
app.use('/api/rules',    rulesRouter);
app.use('/api/decoders', rulesRouter);
app.use('/api/agents',   agentsRouter);
app.use('/api/config',   configRouter);
app.use('/api/backup',     backupRouter);
app.use('/api/history',    historyRouter);
app.use('/api/lists',      listsRouter);
app.use('/api/containers', containersRouter);
app.use('/api/conflicts',  conflictsRouter);

// Expose config info publicly so login page can show it
app.get('/api/config/info', (req, res) => {
  res.json({
    apiURL:    process.env.WAZUH_API_URL || 'https://localhost:55000',
    container: process.env.WAZUH_CONTAINER || '(auto-discover)',
  });
});

// Health — public
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

// Console link — public
app.get('/api/health/console', (req, res) => {
  const os   = require('os');
  const nets = os.networkInterfaces();
  let hostIP = 'localhost';
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) { hostIP = iface.address; break; }
    }
    if (hostIP !== 'localhost') break;
  }
  const dashboardPort = process.env.WAZUH_DASHBOARD_PORT || '443';
  res.json({
    hostIP,
    dashboardURL: `https://${hostIP}:${dashboardPort}`,
    apiURL: process.env.WAZUH_API_URL || 'https://localhost:55000',
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('[express] Unhandled error:', err);
  res.status(500).json({ error: err.message });
});

// ---------------------------------------------------------------------------
// Start HTTP server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\nwazuh-web-manager running at http://localhost:${PORT}`);
  console.log(`  Container : ${process.env.WAZUH_CONTAINER || '(auto-discover)'}`);
  console.log(`  API URL   : ${process.env.WAZUH_API_URL   || 'https://localhost:55000'}`);
  console.log(`  Auth      : Wazuh API credentials\n`);
});
