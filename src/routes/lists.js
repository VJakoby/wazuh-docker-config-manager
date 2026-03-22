'use strict';

const express = require('express');
const router  = express.Router();
const docker  = require('../docker');

const LISTS_DIR = '/var/ossec/etc/lists';

// ---------------------------------------------------------------------------
// List all CDB list files
// GET /api/lists
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  try {
    const files = await docker.listDir(LISTS_DIR);
    // Filter out .sum files (checksums) — only show the actual list files
    const lists = files.filter(f => !f.endsWith('.sum'));
    res.json({ lists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Read a CDB list file — returns parsed entries
// GET /api/lists/:name
// ---------------------------------------------------------------------------

router.get('/:name', async (req, res) => {
  try {
    const name    = sanitiseName(req.params.name);
    const content = await docker.readFile(`${LISTS_DIR}/${name}`);
    const entries = parseList(content);
    res.json({ name, entries, raw: content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Save a CDB list — accepts array of entries
// PUT /api/lists/:name   body: { entries: [{ key, value }] }
// ---------------------------------------------------------------------------

router.put('/:name', async (req, res) => {
  try {
    const name = sanitiseName(req.params.name);
    const { entries } = req.body;

    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'entries must be an array' });
    }

    const content = serialiseList(entries);
    await docker.writeFile(`${LISTS_DIR}/${name}`, content);
    res.json({ ok: true, name, count: entries.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Create a new empty CDB list
// POST /api/lists   body: { name }
// ---------------------------------------------------------------------------

router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const safeName = sanitiseName(name);
    await docker.writeFile(`${LISTS_DIR}/${safeName}`, '');
    res.json({ ok: true, name: safeName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Delete a CDB list
// DELETE /api/lists/:name
// ---------------------------------------------------------------------------

router.delete('/:name', async (req, res) => {
  try {
    const name = sanitiseName(req.params.name);
    await docker.deleteFile(`${LISTS_DIR}/${name}`);
    // Also remove the .sum file if it exists
    await docker.deleteFile(`${LISTS_DIR}/${name}.sum`).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitiseName(name) {
  return name.replace(/[^a-zA-Z0-9_\-\.]/g, '').replace(/\.{2,}/g, '');
}

/**
 * Parse a CDB list file into an array of { key, value } objects.
 * CDB format: one entry per line, either "key:value" or just "key"
 */
function parseList(content) {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('#'))
    .map(line => {
      const colon = line.indexOf(':');
      if (colon === -1) return { key: line, value: '' };
      return {
        key:   line.slice(0, colon).trim(),
        value: line.slice(colon + 1).trim(),
      };
    });
}

/**
 * Serialise entries back to CDB list format.
 */
function serialiseList(entries) {
  return entries
    .filter(e => e.key && e.key.trim())
    .map(e => e.value ? `${e.key.trim()}:${e.value.trim()}` : e.key.trim())
    .join('\n') + '\n';
}

module.exports = router;
