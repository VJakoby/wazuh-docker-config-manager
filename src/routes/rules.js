'use strict';

const express = require('express');
const router  = express.Router();
const docker  = require('../docker');

// Custom (editable by users)
const CUSTOM_RULES_DIR    = '/var/ossec/etc/rules';
const CUSTOM_DECODERS_DIR = '/var/ossec/etc/decoders';

// Default (shipped with Wazuh — still editable but clearly labelled)
const DEFAULT_RULES_DIR    = '/var/ossec/ruleset/rules';
const DEFAULT_DECODERS_DIR = '/var/ossec/ruleset/decoders';

/**
 * Resolve the directory for a given type + source combination.
 * type:   'rules' | 'decoders'
 * source: 'custom' | 'default'  (default: 'custom')
 */
function dirFor(type, source) {
  const isDecoder = type === 'decoders';
  const isDefault = source === 'default';
  if (isDecoder) return isDefault ? DEFAULT_DECODERS_DIR : CUSTOM_DECODERS_DIR;
  return isDefault ? DEFAULT_RULES_DIR : CUSTOM_RULES_DIR;
}

function typeFromUrl(baseUrl) {
  return baseUrl.includes('decoder') ? 'decoders' : 'rules';
}

// ---------------------------------------------------------------------------
// List files
// GET /api/rules?source=custom|default
// GET /api/decoders?source=custom|default
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  try {
    const type   = typeFromUrl(req.baseUrl);
    const source = req.query.source || 'custom';
    const dir    = dirFor(type, source);

    const all   = await docker.listDir(dir);
    const files = all.filter(f => f.endsWith('.xml'));
    res.json({ files, source, dir });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Read a single file
// GET /api/rules/:filename?source=custom|default
// ---------------------------------------------------------------------------

router.get('/:filename', async (req, res) => {
  try {
    const type     = typeFromUrl(req.baseUrl);
    const source   = req.query.source || 'custom';
    const dir      = dirFor(type, source);
    const safeName = sanitiseFilename(req.params.filename);

    const content = await docker.readFile(`${dir}/${safeName}`);
    res.json({ filename: safeName, content, source, path: `${dir}/${safeName}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Create or update a file
// PUT /api/rules/:filename?source=custom|default   body: { content }
// ---------------------------------------------------------------------------

router.put('/:filename', async (req, res) => {
  try {
    const type     = typeFromUrl(req.baseUrl);
    const source   = req.query.source || 'custom';
    const dir      = dirFor(type, source);
    const safeName = sanitiseFilename(req.params.filename);
    const { content } = req.body;

    if (!content) return res.status(400).json({ error: 'content is required' });

    const xmlErr = validateXML(content);
    if (xmlErr) return res.status(400).json({ error: `Invalid XML: ${xmlErr}` });

    await docker.writeFile(`${dir}/${safeName}`, content);
    res.json({ ok: true, filename: safeName, source, path: `${dir}/${safeName}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Delete a file
// DELETE /api/rules/:filename?source=custom|default
// ---------------------------------------------------------------------------

router.delete('/:filename', async (req, res) => {
  try {
    const type     = typeFromUrl(req.baseUrl);
    const source   = req.query.source || 'custom';
    const dir      = dirFor(type, source);
    const safeName = sanitiseFilename(req.params.filename);

    // Warn but still allow deleting default files — user knows what they're doing
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
  const base = name.replace(/[^a-zA-Z0-9_\-\.]/g, '').replace(/\.{2,}/g, '');
  return base.endsWith('.xml') ? base : `${base}.xml`;
}

function validateXML(content) {
  try {
    let depth = 0;
    const tagRe = /<\/?[a-zA-Z][^>]*>/g;
    let m;
    while ((m = tagRe.exec(content)) !== null) {
      if (m[0].startsWith('</')) depth--;
      else if (!m[0].endsWith('/>')) depth++;
    }
    if (depth < 0) return 'Unmatched closing tags';
    return null;
  } catch (e) {
    return e.message;
  }
}

function parseLogtest(raw) {
  const result = { predecoding: {}, decoding: {}, rule: {}, fields: {}, error: null };

  if (!raw || raw.trim() === '') {
    result.error = 'No output from wazuh-logtest';
    return result;
  }

  const lines = raw.split('\n');
  let section = null;

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (l.includes('Phase 1')) { section = 'predecoding'; continue; }
    if (l.includes('Phase 2')) { section = 'decoding';    continue; }
    if (l.includes('Phase 3')) { section = 'rule';        continue; }

    const match = l.match(/^([\w\s\.]+?):\s+['"]?(.+?)['"]?$/);
    if (!match) continue;

    const key   = match[1].trim().toLowerCase().replace(/\s+/g, '_');
    const value = match[2].trim();

    if (section === 'predecoding') {
      result.predecoding[key] = value;
    } else if (section === 'decoding') {
      result.decoding[key] = value;
    } else if (section === 'rule') {
      if (key === 'rule_id' || key === 'id')                result.rule.id          = value;
      else if (key === 'level')                              result.rule.level       = parseInt(value) || 0;
      else if (key === 'description')                        result.rule.description = value;
      else if (key === 'groups' || key === 'group')          result.rule.groups      = value;
      else if (key === 'firedtimes' || key === 'fired_times') result.rule.firedTimes = value;
      else                                                   result.rule[key]        = value;
    }
  }

  if (!result.rule.id && !result.decoding.name) {
    if (raw.includes('No rule match') || raw.includes('**No match')) {
      result.error = 'No rule matched this log line.';
    }
  }

  return result;
}

module.exports = router;