'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const MAX_HISTORY = Math.max(parseInt(process.env.HISTORY_LIMIT || '25', 10) || 25, 5);

function safeSegment(value) {
  return String(value || 'unknown')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

function targetDir(meta) {
  const source = meta.source || 'custom';
  return path.join(
    HISTORY_DIR,
    safeSegment(meta.scope),
    safeSegment(meta.type || meta.scope),
    safeSegment(source),
    safeSegment(meta.filename)
  );
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function saveSnapshot(meta) {
  if (!meta?.scope || !meta?.filename) {
    throw new Error('Snapshot metadata requires scope and filename');
  }

  const dir = targetDir(meta);
  await ensureDir(dir);

  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.json`;
  const entry = {
    id,
    createdAt,
    scope: meta.scope,
    type: meta.type || meta.scope,
    source: meta.source || 'custom',
    filename: meta.filename,
    path: meta.path || '',
    action: meta.action || 'snapshot',
    note: meta.note || '',
    size: Buffer.byteLength(meta.content || '', 'utf8'),
    content: meta.content || '',
  };

  await fs.writeFile(path.join(dir, id), JSON.stringify(entry, null, 2), 'utf8');
  await pruneSnapshots(dir);
  return summary(entry);
}

async function pruneSnapshots(dir) {
  const files = (await fs.readdir(dir)).filter(name => name.endsWith('.json')).sort().reverse();
  const stale = files.slice(MAX_HISTORY);
  await Promise.all(stale.map(file => fs.unlink(path.join(dir, file)).catch(() => {})));
}

async function listSnapshots(meta) {
  const dir = targetDir(meta);
  try {
    const files = (await fs.readdir(dir)).filter(name => name.endsWith('.json')).sort().reverse();
    const entries = await Promise.all(
      files.map(async (file) => {
        const raw = await fs.readFile(path.join(dir, file), 'utf8');
        return summary(JSON.parse(raw));
      })
    );
    return entries;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function getSnapshot(meta, id) {
  if (!/^[a-zA-Z0-9._-]+\.json$/.test(id || '')) {
    throw new Error('Invalid snapshot ID');
  }
  const file = path.join(targetDir(meta), id);
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

function summary(entry) {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    scope: entry.scope,
    type: entry.type,
    source: entry.source,
    filename: entry.filename,
    path: entry.path,
    action: entry.action,
    note: entry.note,
    size: entry.size,
  };
}

module.exports = {
  DATA_DIR,
  HISTORY_DIR,
  saveSnapshot,
  listSnapshots,
  getSnapshot,
};
