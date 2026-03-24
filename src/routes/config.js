'use strict';

const express = require('express');
const router = express.Router();
const docker = require('../docker');
const api = require('../wazuh-api');
const history = require('../history');
const { XMLValidator } = require('fast-xml-parser');

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

    const xmlErr = validateXML(content);
    if (xmlErr) {
      return res.status(400).json({ error: `Invalid XML: ${xmlErr}` });
    }

    if (!content.includes('<ossec_config')) {
      return res.status(400).json({ error: 'Content does not look like a valid ossec.conf — missing <ossec_config> root element' });
    }

    const previous = await docker.readFile(OSSEC_CONF).catch(() => null);
    if (previous !== null && previous !== content) {
      await history.saveSnapshot({
        scope: 'config',
        type: 'config',
        source: 'custom',
        filename: 'ossec.conf',
        path: OSSEC_CONF,
        action: 'pre-save',
        note: 'Before saving ossec.conf',
        content: previous,
      });
    }

    await docker.writeFile(OSSEC_CONF, content);
    res.json({ ok: true, snapshotCreated: previous !== null && previous !== content });
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
      api.getManagerInfo(api.fromSession(req.session)).catch(() => null),
      api.getManagerStatus(api.fromSession(req.session)).catch(() => null),
      docker.containerInfo().catch(() => null),
    ]);
    res.json({ info, status, container });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function validateXML(content) {
  const result = XMLValidator.validate(content);
  if (result === true) return null;
  return result.err?.msg || 'Malformed XML';
}

module.exports = router;
