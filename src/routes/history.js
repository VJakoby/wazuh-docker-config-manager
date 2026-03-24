'use strict';

const express = require('express');
const router = express.Router();
const docker = require('../docker');
const history = require('../history');
const { XMLValidator } = require('fast-xml-parser');

const CUSTOM_RULES_DIR = '/var/ossec/etc/rules';
const CUSTOM_DECODERS_DIR = '/var/ossec/etc/decoders';
const DEFAULT_RULES_DIR = '/var/ossec/ruleset/rules';
const DEFAULT_DECODERS_DIR = '/var/ossec/ruleset/decoders';
const OSSEC_CONF = '/var/ossec/etc/ossec.conf';

router.get('/', async (req, res) => {
  try {
    const target = resolveTarget(req.query);
    const entries = await history.listSnapshots(target);
    res.json({ entries, target });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const target = resolveTarget(req.query);
    const entry = await history.getSnapshot(target, req.params.id);
    res.json({ entry });
  } catch (err) {
    const status = err.code === 'ENOENT' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.post('/:id/restore', async (req, res) => {
  try {
    const target = resolveTarget(req.query);
    const entry = await history.getSnapshot(target, req.params.id);
    const currentContent = await docker.readFile(target.path).catch(() => '');

    if (currentContent) {
      await history.saveSnapshot({
        ...target,
        content: currentContent,
        action: 'pre-restore',
        note: `Before restoring snapshot ${entry.id}`,
      });
    }

    const xmlErr = validateXML(entry.content);
    if (xmlErr) {
      return res.status(400).json({ error: `Snapshot XML is invalid: ${xmlErr}` });
    }

    await docker.writeFile(target.path, entry.content);
    res.json({
      ok: true,
      restored: historySummary(entry),
      target,
    });
  } catch (err) {
    const status = err.code === 'ENOENT' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

function resolveTarget(query) {
  const scope = query.scope;
  const source = query.source || 'custom';
  const filename = sanitiseFilename(query.filename || '');

  if (scope === 'config') {
    return {
      scope: 'config',
      type: 'config',
      source: 'custom',
      filename: 'ossec.conf',
      path: OSSEC_CONF,
    };
  }

  if (scope !== 'rules' && scope !== 'decoders') {
    throw new Error('Unsupported history scope');
  }
  if (!filename) throw new Error('filename is required');

  const dir = dirFor(scope, source);
  return {
    scope,
    type: scope,
    source,
    filename,
    path: `${dir}/${filename}`,
  };
}

function dirFor(type, source) {
  const isDecoder = type === 'decoders';
  const isDefault = source === 'default';
  if (isDecoder) return isDefault ? DEFAULT_DECODERS_DIR : CUSTOM_DECODERS_DIR;
  return isDefault ? DEFAULT_RULES_DIR : CUSTOM_RULES_DIR;
}

function sanitiseFilename(name) {
  const base = String(name || '').replace(/[^a-zA-Z0-9_\-.]/g, '').replace(/\.{2,}/g, '');
  if (!base) return '';
  return base.endsWith('.xml') || base === 'ossec.conf' ? base : `${base}.xml`;
}

function validateXML(content) {
  const result = XMLValidator.validate(content);
  if (result === true) return null;
  return result.err?.msg || 'Malformed XML';
}

function historySummary(entry) {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    action: entry.action,
    filename: entry.filename,
    source: entry.source,
  };
}

module.exports = router;
