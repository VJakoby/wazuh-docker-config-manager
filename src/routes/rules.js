'use strict';

const express = require('express');
const router = express.Router();
const docker = require('../docker');

const RULES_DIR = '/var/ossec/etc/rules';
const DECODERS_DIR = '/var/ossec/etc/decoders';

function dirFor(type) {
  if (type === 'decoders') return DECODERS_DIR;
  return RULES_DIR;
}

// ---------------------------------------------------------------------------
// List files
// GET /api/rules        → lists rule XML files
// GET /api/decoders     → lists decoder XML files
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  try {
    const dir = dirFor(req.baseUrl.includes('decoder') ? 'decoders' : 'rules');
    const all = await docker.listDir(dir);
    const files = all.filter(f => f.endsWith('.xml'));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Read a single file
// GET /api/rules/:filename
// ---------------------------------------------------------------------------

router.get('/:filename', async (req, res) => {
  try {
    const dir = dirFor(req.baseUrl.includes('decoder') ? 'decoders' : 'rules');
    const safeName = sanitiseFilename(req.params.filename);
    const content = await docker.readFile(`${dir}/${safeName}`);
    res.json({ filename: safeName, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Create or update a file
// PUT /api/rules/:filename   body: { content }
// ---------------------------------------------------------------------------

router.put('/:filename', async (req, res) => {
  try {
    const dir = dirFor(req.baseUrl.includes('decoder') ? 'decoders' : 'rules');
    const safeName = sanitiseFilename(req.params.filename);
    const { content } = req.body;

    if (!content) return res.status(400).json({ error: 'content is required' });

    const xmlErr = validateXML(content);
    if (xmlErr) return res.status(400).json({ error: `Invalid XML: ${xmlErr}` });

    await docker.writeFile(`${dir}/${safeName}`, content);
    res.json({ ok: true, filename: safeName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Delete a file
// DELETE /api/rules/:filename
// ---------------------------------------------------------------------------

router.delete('/:filename', async (req, res) => {
  try {
    const dir = dirFor(req.baseUrl.includes('decoder') ? 'decoders' : 'rules');
    const safeName = sanitiseFilename(req.params.filename);
    await docker.deleteFile(`${dir}/${safeName}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Reload the Wazuh manager
// POST /api/rules/actions/reload
// ---------------------------------------------------------------------------

router.post('/actions/reload', async (req, res) => {
  try {
    const output = await docker.reloadManager();
    res.json({ ok: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Run logtest
// POST /api/rules/actions/logtest   body: { log }
// ---------------------------------------------------------------------------

router.post('/actions/logtest', async (req, res) => {
  try {
    const { log } = req.body;
    if (!log) return res.status(400).json({ error: 'log line is required' });
    const raw = await docker.runLogtest(log);
    res.json({ raw, parsed: parseLogtest(raw) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitiseFilename(name) {
  // Strip path traversal and enforce .xml extension
  const base = name.replace(/[^a-zA-Z0-9_\-\.]/g, '').replace(/\.{2,}/g, '');
  return base.endsWith('.xml') ? base : `${base}.xml`;
}

/**
 * Very basic XML well-formedness check using the built-in parser.
 * Returns an error string or null.
 */
function validateXML(content) {
  // We can't use DOMParser in Node, so do a minimal tag-balance check.
  // For real validation, consider the 'fast-xml-parser' package.
  try {
    let depth = 0;
    const tagRe = /<\/?[a-zA-Z][^>]*>/g;
    let m;
    while ((m = tagRe.exec(content)) !== null) {
      if (m[0].startsWith('</')) depth--;
      else if (!m[0].endsWith('/>')) depth++;
    }
    // After parsing all tags depth doesn't need to be exactly 0 for a group
    // of elements — just make sure it's not negative
    if (depth < 0) return 'Unmatched closing tags';
    return null;
  } catch (e) {
    return e.message;
  }
}

// ---------------------------------------------------------------------------
// Logtest output parser
// ---------------------------------------------------------------------------

function parseLogtest(raw) {
  const result = {
    predecoding: {},
    decoding:    {},
    rule:        {},
    fields:      {},
    error:       null,
  };

  if (!raw || raw.trim() === '') {
    result.error = 'No output from wazuh-logtest';
    return result;
  }

  const lines = raw.split('\n');
  let section = null;

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    // Section headers
    if (l.includes('Phase 1')) { section = 'predecoding'; continue; }
    if (l.includes('Phase 2')) { section = 'decoding';    continue; }
    if (l.includes('Phase 3')) { section = 'rule';        continue; }

    // Key: value pairs
    const match = l.match(/^([\w\s\.]+?):\s+['"]?(.+?)['"]?$/);
    if (!match) continue;

    const key   = match[1].trim().toLowerCase().replace(/\s+/g, '_');
    const value = match[2].trim();

    if (section === 'predecoding') {
      result.predecoding[key] = value;
    } else if (section === 'decoding') {
      result.decoding[key] = value;
    } else if (section === 'rule') {
      // Hoist key rule fields to top level
      if (key === 'rule_id' || key === 'id')          result.rule.id          = value;
      else if (key === 'level')                         result.rule.level       = parseInt(value) || 0;
      else if (key === 'description')                   result.rule.description = value;
      else if (key === 'groups' || key === 'group')     result.rule.groups      = value;
      else if (key === 'firedtimes' || key === 'fired_times') result.rule.firedTimes = value;
      else                                              result.rule[key]        = value;
    }
  }

  // Check if anything matched at all
  if (!result.rule.id && !result.decoding.name) {
    // Look for explicit "no rule matched" message
    if (raw.includes('No rule match') || raw.includes('**No match')) {
      result.error = 'No rule matched this log line.';
    }
  }

  return result;
}

module.exports = router;
