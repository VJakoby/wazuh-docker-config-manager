'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');

const rulesRouter = require('./src/routes/rules');
const agentsRouter = require('./src/routes/agents');
const configRouter = require('./src/routes/config');
const app = express();
const PORT = process.env.PORT || 1234;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.use('/api/rules', rulesRouter);
app.use('/api/decoders', rulesRouter);   // same router, path tells it which dir
app.use('/api/agents', agentsRouter);
app.use('/api/config', configRouter);

// Health check
app.get('/api/health', async (req, res) => {
  const docker = require('./src/docker');
  try {
    const info = await docker.containerInfo();
    res.json({ ok: true, container: info });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// SPA fallback — serve index.html for any non-API route
// ---------------------------------------------------------------------------

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\nwazuh-web-manager running at http://localhost:${PORT}`);
  console.log(`  Container : ${process.env.WAZUH_CONTAINER || '(auto-discover)'}`);
  console.log(`  API URL   : ${process.env.WAZUH_API_URL || 'https://localhost:55000'}\n`);
});
