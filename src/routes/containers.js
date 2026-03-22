'use strict';

const express = require('express');
const router  = express.Router();
const docker  = require('../docker');

// ---------------------------------------------------------------------------
// List all Wazuh containers with status
// GET /api/containers
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  try {
    const containers = await docker.listWazuhContainers();
    res.json({ containers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Restart a container
// POST /api/containers/:name/restart
// ---------------------------------------------------------------------------

router.post('/:name/restart', async (req, res) => {
  const name = req.params.name;
  console.log(`[containers] Restarting "${name}"...`);
  try {
    await docker.restartContainer(name);
    console.log(`[containers] "${name}" restarted`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[containers] Failed to restart "${name}":`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Stop a container
// POST /api/containers/:name/stop
// ---------------------------------------------------------------------------

router.post('/:name/stop', async (req, res) => {
  const name = req.params.name;
  console.log(`[containers] Stopping "${name}"...`);
  try {
    await docker.stopContainer(name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start a container
// POST /api/containers/:name/start
// ---------------------------------------------------------------------------

router.post('/:name/start', async (req, res) => {
  const name = req.params.name;
  console.log(`[containers] Starting "${name}"...`);
  try {
    await docker.startContainer(name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
