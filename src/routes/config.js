'use strict';

const express = require('express');
const router = express.Router();
const docker = require('../docker');
const api = require('../wazuh-api');

const OSSEC_CONF = '/var/ossec/etc/ossec.conf';

// ---------------------------------------------------------------------------
// Read ossec.conf
// GET /api/config/ossec
// ---------------------------------------------------------------------------

router.get('/ossec', async (req, res) => {
  try {
    const content = await docker.readFile(OSSEC_CONF);
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Write ossec.conf
// PUT /api/config/ossec   body: { content }
// ---------------------------------------------------------------------------

router.put('/ossec', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });

    // Basic XML sanity check before writing
    if (!content.includes('<ossec_config>')) {
      return res.status(400).json({ error: 'Content does not look like a valid ossec.conf — missing <ossec_config> root element' });
    }

    await docker.writeFile(OSSEC_CONF, content);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Reload manager after config change
// POST /api/config/reload
// ---------------------------------------------------------------------------

router.post('/reload', async (req, res) => {
  try {
    const output = await docker.reloadManager();
    res.json({ ok: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Manager info + status (from Wazuh API)
// GET /api/config/status
// ---------------------------------------------------------------------------

router.get('/status', async (req, res) => {
  try {
    const [info, status, container] = await Promise.all([
      api.getManagerInfo().catch(() => null),
      api.getManagerStatus().catch(() => null),
      docker.containerInfo().catch(() => null),
    ]);
    res.json({ info, status, container });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
