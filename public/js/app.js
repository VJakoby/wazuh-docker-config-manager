import { initRulesPage }  from './rules.js';
import { initAgentsPage } from './agents.js';
import { initConfigPage } from './config.js';
import { initBackupPage } from './backup.js';

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export function toast(message, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

export function showConfirm(title, message) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent   = title;
    document.getElementById('confirmMessage').textContent = message;
    modal.style.display = 'flex';

    const cleanup = (result) => {
      modal.style.display = 'none';
      document.getElementById('confirmOk').replaceWith(document.getElementById('confirmOk').cloneNode(true));
      document.getElementById('confirmCancel').replaceWith(document.getElementById('confirmCancel').cloneNode(true));
      resolve(result);
    };

    document.getElementById('confirmOk').addEventListener('click',     () => cleanup(true));
    document.getElementById('confirmCancel').addEventListener('click', () => cleanup(false));
  });
}

export function showNewFileModal(type) {
  return new Promise(resolve => {
    const modal = document.getElementById('newFileModal');
    document.getElementById('newFileModalTitle').textContent =
      `New ${type === 'decoders' ? 'Decoder' : 'Rule'} File`;
    const input = document.getElementById('newFilename');
    input.value = '';
    modal.style.display = 'flex';
    input.focus();

    const cleanup = (value) => {
      modal.style.display = 'none';
      document.getElementById('newFileCreate').replaceWith(document.getElementById('newFileCreate').cloneNode(true));
      document.getElementById('newFileCancel').replaceWith(document.getElementById('newFileCancel').cloneNode(true));
      resolve(value);
    };

    document.getElementById('newFileCreate').addEventListener('click', () => cleanup(input.value.trim() || null));
    document.getElementById('newFileCancel').addEventListener('click', () => cleanup(null));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  cleanup(input.value.trim() || null);
      if (e.key === 'Escape') cleanup(null);
    });
  });
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

export async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Connection badge + chips
// ---------------------------------------------------------------------------

async function updateConsoleLink() {
  try {
    const data = await apiFetch('/api/health/console');
    const btn  = document.getElementById('consoleLink');
    const text = document.getElementById('consoleLinkText');
    const addr = document.getElementById('consoleLinkAddr');
    if (btn && data.dashboardURL) {
      btn.dataset.url  = data.dashboardURL;
      btn.disabled     = false;
      text.textContent = 'Open dashboard ↗';
      addr.textContent = data.dashboardURL.replace('https://', '');
    }
  } catch {
    const addr = document.getElementById('consoleLinkAddr');
    if (addr) addr.textContent = 'unavailable';
  }
}

async function updateStatus() {
  const dot   = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  const chipV = document.getElementById('chipVersion');
  const chipS = document.getElementById('chipStatus');

  try {
    const data = await apiFetch('/api/health');
    const c = data.container;
    dot.className      = 'conn-dot connected';
    label.textContent  = c?.name || 'connected';
    chipS.textContent  = `● ${c?.status || 'running'}`;
    chipS.className    = 'chip ok';

    try {
      const cfg = await apiFetch('/api/config/status');
      chipV.textContent = cfg.info?.version || '—';
    } catch { /* non-critical */ }

  } catch {
    dot.className     = 'conn-dot error';
    label.textContent = 'not connected';
    chipS.textContent = '● offline';
    chipS.className   = 'chip';
  }
}

// ---------------------------------------------------------------------------
// Sidebar reload button
// ---------------------------------------------------------------------------

document.getElementById('reloadBtn').addEventListener('click', async () => {
  const btn = document.getElementById('reloadBtn');
  btn.disabled    = true;
  btn.textContent = '↻ Reloading…';
  try {
    await apiFetch('/api/config/reload', { method: 'POST' });
    toast('Wazuh manager reloaded', 'success');
  } catch (err) {
    toast(`Reload failed: ${err.message}`, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '↺ Reload Manager';
  }
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const PAGE_LABELS = {
  rules:    'Rules',
  decoders: 'Decoders',
  agents:   'Agents',
  config:   'ossec.conf',
  backup:   'Backup & Restore',
};

const routes = {
  rules:    () => initRulesPage('rules'),
  decoders: () => initRulesPage('decoders'),
  agents:   () => initAgentsPage(),
  config:   () => initConfigPage(),
  backup:   () => initBackupPage(),
};

function navigate(page) {
  // Active nav link
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // rules and decoders share #page-rules
  const pageId = page === 'decoders' ? 'rules' : page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${pageId}`)?.classList.add('active');

  // Breadcrumb
  document.getElementById('hSection').textContent = PAGE_LABELS[page] || page;
  document.getElementById('hFile').textContent    = '';

  (routes[page] || routes.rules)();
}

function onHashChange() {
  navigate(location.hash.replace('#', '') || 'rules');
}

window.addEventListener('hashchange', onHashChange);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

window.__cmEditors = window.__cmEditors || [];

updateStatus();
updateConsoleLink();
setInterval(updateStatus, 30_000);
onHashChange();
