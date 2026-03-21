import { toast } from './app.js';

// ---------------------------------------------------------------------------
// Page init
// ---------------------------------------------------------------------------

export function initBackupPage() {
  replaceWithClone('backupDownloadBtn').addEventListener('click', handleDownload);
  replaceWithClone('restoreSelectBtn').addEventListener('click', () => {
    document.getElementById('restoreFileInput').click();
  });

  const fileInput = document.getElementById('restoreFileInput');
  fileInput.value = '';
  fileInput.addEventListener('change', handleFileSelected);

  replaceWithClone('restoreConfirmBtn').addEventListener('click', handleRestore);
  replaceWithClone('restoreCancelBtn').addEventListener('click', cancelRestore);

  // Reset UI state
  document.getElementById('restorePreview').style.display = 'none';
  document.getElementById('restoreResult').style.display = 'none';
}

function replaceWithClone(id) {
  const el = document.getElementById(id);
  if (!el) return { addEventListener: () => {} };
  const clone = el.cloneNode(true);
  el.replaceWith(clone);
  return clone;
}

// ---------------------------------------------------------------------------
// Backup download
// ---------------------------------------------------------------------------

async function handleDownload() {
  const btn = document.getElementById('backupDownloadBtn');
  btn.disabled = true;
  btn.textContent = 'Preparing…';

  try {
    const res = await fetch('/api/backup/download');
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    // Extract filename from Content-Disposition header
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="(.+?)"/);
    const filename = match ? match[1] : 'wazuh-backup.zip';

    // Trigger browser download
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    toast(`Backup downloaded: ${filename}`, 'success');
  } catch (err) {
    toast(`Backup failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '↓ Download Backup';
  }
}

// ---------------------------------------------------------------------------
// Restore — file selection & preview
// ---------------------------------------------------------------------------

let selectedFile = null;

async function handleFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  selectedFile = file;

  const preview  = document.getElementById('restorePreview');
  const fileList = document.getElementById('restoreFileList');
  const nameEl   = document.getElementById('restoreFilename');
  const result   = document.getElementById('restoreResult');

  result.style.display  = 'none';
  nameEl.textContent    = file.name;
  fileList.textContent  = 'Loading preview…';
  preview.style.display = 'block';

  try {
    const form = new FormData();
    form.append('file', file);

    const res  = await fetch('/api/backup/preview', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    fileList.textContent = data.files.join('\n') || '(no files found)';
  } catch (err) {
    fileList.textContent = `Error reading backup: ${err.message}`;
  }
}

function cancelRestore() {
  selectedFile = null;
  document.getElementById('restoreFileInput').value = '';
  document.getElementById('restorePreview').style.display = 'none';
  document.getElementById('restoreResult').style.display  = 'none';
}

// ---------------------------------------------------------------------------
// Restore — confirm and write files
// ---------------------------------------------------------------------------

async function handleRestore() {
  if (!selectedFile) return;

  const btn    = document.getElementById('restoreConfirmBtn');
  const result = document.getElementById('restoreResult');
  const body   = document.getElementById('restoreResultBody');

  btn.disabled    = true;
  btn.textContent = 'Restoring…';

  try {
    const form = new FormData();
    form.append('file', selectedFile);

    const res  = await fetch('/api/backup/restore', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const restoredLines = data.restored.map(f => `✓ ${f}`).join('\n');
    const errorLines    = data.errors.map(e => `✗ ${e.file}: ${e.error}`).join('\n');
    body.textContent    = [restoredLines, errorLines].filter(Boolean).join('\n') || '(nothing restored)';

    result.style.display = 'block';
    result.className     = data.errors.length ? 'restore-result warn' : 'restore-result ok';

    if (data.errors.length === 0) {
      toast(`Restored ${data.restored.length} files successfully`, 'success');
    } else {
      toast(`Restored ${data.restored.length} files with ${data.errors.length} errors`, 'error');
    }

    // Reset file selection
    selectedFile = null;
    document.getElementById('restoreFileInput').value = '';
    document.getElementById('restorePreview').style.display = 'none';

  } catch (err) {
    toast(`Restore failed: ${err.message}`, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Restore';
  }
}
