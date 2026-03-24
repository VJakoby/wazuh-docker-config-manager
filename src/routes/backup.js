'use strict';

const express  = require('express');
const router   = express.Router();
const docker   = require('../docker');
const history  = require('../history');
const JSZip    = require('jszip');
const multer   = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const BACKUP_PATHS = {
  'ossec.conf': '/var/ossec/etc/ossec.conf',
};
const RULES_DIR    = '/var/ossec/etc/rules';
const DECODERS_DIR = '/var/ossec/etc/decoders';

async function snapshotBeforeRestore(scope, filename, targetPath, note) {
  const previous = await docker.readFile(targetPath).catch(() => null);
  if (previous === null) return;

  await history.saveSnapshot({
    scope,
    type: scope === 'config' ? 'config' : scope,
    source: 'custom',
    filename,
    path: targetPath,
    action: 'pre-restore',
    note,
    content: previous,
  });
}

// ---------------------------------------------------------------------------
// Create backup
// GET /api/backup/download
// ---------------------------------------------------------------------------

router.get('/download', async (req, res) => {
  console.log('[backup] Starting backup...');
  try {
    const zip = new JSZip();

    // ossec.conf
    try {
      const content = await docker.readFile(BACKUP_PATHS['ossec.conf']);
      zip.file('ossec.conf', content);
      console.log('[backup] Added ossec.conf');
    } catch (err) {
      console.error('[backup] Could not read ossec.conf:', err.message);
    }

    // Custom rules
    const ruleFiles = await docker.listDir(RULES_DIR);
    const xmlRules = ruleFiles.filter(f => f.endsWith('.xml'));
    const rulesFolder = zip.folder('rules');
    for (const f of xmlRules) {
      try {
        const content = await docker.readFile(`${RULES_DIR}/${f}`);
        rulesFolder.file(f, content);
        console.log(`[backup] Added rules/${f}`);
      } catch (err) {
        console.error(`[backup] Could not read rules/${f}:`, err.message);
      }
    }

    // Custom decoders
    const decoderFiles = await docker.listDir(DECODERS_DIR);
    const xmlDecoders = decoderFiles.filter(f => f.endsWith('.xml'));
    const decodersFolder = zip.folder('decoders');
    for (const f of xmlDecoders) {
      try {
        const content = await docker.readFile(`${DECODERS_DIR}/${f}`);
        decodersFolder.file(f, content);
        console.log(`[backup] Added decoders/${f}`);
      } catch (err) {
        console.error(`[backup] Could not read decoders/${f}:`, err.message);
      }
    }

    // Manifest
    const manifest = {
      created:   new Date().toISOString(),
      rules:     xmlRules,
      decoders:  xmlDecoders,
      includes:  ['ossec.conf', ...xmlRules.map(f => `rules/${f}`), ...xmlDecoders.map(f => `decoders/${f}`)],
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename  = `wazuh-backup-${timestamp}.zip`;

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    console.log(`[backup] Done — ${buffer.length} bytes, ${manifest.includes.length} files`);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (err) {
    console.error('[backup] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Preview backup contents
// POST /api/backup/preview   multipart: file
// ---------------------------------------------------------------------------

router.post('/preview', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const zip = await JSZip.loadAsync(req.file.buffer);
    const manifest = zip.file('manifest.json');

    let files = [];
    if (manifest) {
      const raw = await manifest.async('string');
      const m   = JSON.parse(raw);
      files = m.includes || [];
    } else {
      // No manifest — list all files in zip
      zip.forEach(path => { if (!path.endsWith('/')) files.push(path); });
    }

    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: `Could not read backup: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// Restore backup
// POST /api/backup/restore   multipart: file
// ---------------------------------------------------------------------------

router.post('/restore', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  console.log('[backup] Starting restore...');
  const restored = [];
  const errors   = [];

  try {
    const zip = await JSZip.loadAsync(req.file.buffer);

    // ossec.conf
    const ossecFile = zip.file('ossec.conf');
    if (ossecFile) {
      try {
        const content = await ossecFile.async('string');
        await snapshotBeforeRestore('config', 'ossec.conf', '/var/ossec/etc/ossec.conf', 'Before backup restore');
        await docker.writeFile('/var/ossec/etc/ossec.conf', content);
        restored.push('ossec.conf');
        console.log('[backup] Restored ossec.conf');
      } catch (err) {
        errors.push({ file: 'ossec.conf', error: err.message });
        console.error('[backup] Failed to restore ossec.conf:', err.message);
      }
    }

    // Rules
    const ruleFiles = [];
    zip.forEach((path, file) => {
      if (path.startsWith('rules/') && path.endsWith('.xml') && !file.dir) {
        ruleFiles.push({ path, file });
      }
    });
    for (const { path, file } of ruleFiles) {
      try {
        const content  = await file.async('string');
        const filename = path.split('/').pop();
        await snapshotBeforeRestore('rules', filename, `${RULES_DIR}/${filename}`, 'Before backup restore');
        await docker.writeFile(`${RULES_DIR}/${filename}`, content);
        restored.push(path);
        console.log(`[backup] Restored ${path}`);
      } catch (err) {
        errors.push({ file: path, error: err.message });
        console.error(`[backup] Failed to restore ${path}:`, err.message);
      }
    }

    // Decoders
    const decoderFiles = [];
    zip.forEach((path, file) => {
      if (path.startsWith('decoders/') && path.endsWith('.xml') && !file.dir) {
        decoderFiles.push({ path, file });
      }
    });
    for (const { path, file } of decoderFiles) {
      try {
        const content  = await file.async('string');
        const filename = path.split('/').pop();
        await snapshotBeforeRestore('decoders', filename, `${DECODERS_DIR}/${filename}`, 'Before backup restore');
        await docker.writeFile(`${DECODERS_DIR}/${filename}`, content);
        restored.push(path);
        console.log(`[backup] Restored ${path}`);
      } catch (err) {
        errors.push({ file: path, error: err.message });
        console.error(`[backup] Failed to restore ${path}:`, err.message);
      }
    }

    console.log(`[backup] Restore complete — ${restored.length} restored, ${errors.length} errors`);
    res.json({ ok: true, restored, errors });

  } catch (err) {
    console.error('[backup] Fatal restore error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
