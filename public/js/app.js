import { initRulesPage }  from './rules.js';
import { initListsPage }      from './lists.js';
import { initConflictsPage }  from './conflicts.js';
import { initContainersPage, destroyContainersPage } from './containers.js';
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

export function showHistoryModal(target) {
  return new Promise(async (resolve) => {
    const modal = document.getElementById('historyModal');
    const title = document.getElementById('historyTitle');
    const list = document.getElementById('historyList');
    const previewTitle = document.getElementById('historyPreviewTitle');
    const previewBody = document.getElementById('historyPreviewBody');
    const restoreBtn = document.getElementById('historyRestoreBtn');
    const closeBtn = document.getElementById('historyCloseBtn');

    let selected = null;
    let entries = [];

    const cleanup = (result) => {
      modal.style.display = 'none';
      document.getElementById('historyRestoreBtn').replaceWith(restoreBtn.cloneNode(true));
      document.getElementById('historyCloseBtn').replaceWith(closeBtn.cloneNode(true));
      resolve(result);
    };

    async function loadPreview(id) {
      selected = entries.find(entry => entry.id === id) || null;
      if (!selected) return;

      previewTitle.textContent = `${selected.action} · ${formatTs(selected.createdAt)}`;
      previewBody.innerHTML = '<div class="history-empty">Loading snapshot…</div>';

      try {
        const query = new URLSearchParams(target);
        const data = await apiFetch(`/api/history/${encodeURIComponent(id)}?${query.toString()}`);
        previewBody.innerHTML = `<pre>${escapeHtml(data.entry.content || '')}</pre>`;
        restoreBtn.disabled = false;
      } catch (err) {
        previewBody.innerHTML = `<div class="history-empty">${escapeHtml(err.message)}</div>`;
      }

      list.querySelectorAll('.history-entry').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
      });
    }

    title.textContent = `History — ${target.filename}`;
    modal.style.display = 'flex';
    list.innerHTML = '<div class="history-empty">Loading snapshots…</div>';
    previewTitle.textContent = 'Select a snapshot';
    previewBody.innerHTML = '<div class="history-empty">Select a snapshot to preview its contents.</div>';
    restoreBtn.disabled = true;

    try {
      const query = new URLSearchParams(target);
      const data = await apiFetch(`/api/history?${query.toString()}`);
      entries = data.entries || [];

      if (!entries.length) {
        list.innerHTML = '<div class="history-empty">No snapshots yet for this file.</div>';
      } else {
        list.innerHTML = entries.map(entry => `
          <button class="history-entry" data-id="${entry.id}">
            <div class="history-entry-title">${escapeHtml(entry.action)}</div>
            <div class="history-entry-meta">${escapeHtml(formatTs(entry.createdAt))}</div>
          </button>
        `).join('');

        list.querySelectorAll('.history-entry').forEach(el => {
          el.addEventListener('click', () => loadPreview(el.dataset.id));
        });

        await loadPreview(entries[0].id);
      }
    } catch (err) {
      list.innerHTML = `<div class="history-empty">${escapeHtml(err.message)}</div>`;
    }

    document.getElementById('historyRestoreBtn').addEventListener('click', async () => {
      if (!selected) return;
      const confirmed = await showConfirm(
        'Restore snapshot',
        `Restore ${target.filename} from ${formatTs(selected.createdAt)}? The current file will be snapshotted first.`
      );
      if (!confirmed) return;
      cleanup({ action: 'restore', id: selected.id });
    });

    document.getElementById('historyCloseBtn').addEventListener('click', () => cleanup(null));
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

  // Session expired or not authenticated — redirect to login
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }

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

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login.html';
  }
});

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
  conflicts:   'Rule Conflicts',
  lists:       'CDB Lists',
  containers:  'Containers',
};

const routes = {
  rules:    () => initRulesPage('rules'),
  decoders: () => initRulesPage('decoders'),
  agents:   () => initAgentsPage(),
  config:   () => initConfigPage(),
  backup:   () => initBackupPage(),
  conflicts:  () => initConflictsPage(),
  lists:      () => initListsPage(),
  containers: () => initContainersPage(),
};

function navigate(page) {
  // Active nav link
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Stop containers auto-refresh when leaving that page
  if (page !== 'containers') destroyContainersPage();

  // rules and decoders share #page-rules
  const pageId = page === 'decoders'
    ? 'rules'
    : page;
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

// Collapsible file panel
(function() {
  const panel  = document.getElementById('filePanel');
  const toggle = document.getElementById('filePanelToggle');
  if (!panel || !toggle) return;

  let collapsed = localStorage.getItem('filePanelCollapsed') === 'true';

  function apply() {
    panel.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? '▶' : '◀';
    toggle.title = collapsed ? 'Show file panel' : 'Hide file panel';
    localStorage.setItem('filePanelCollapsed', collapsed);
  }

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    apply();
  });

  apply();
})();

// Check session is valid before loading the app
(async () => {
  try {
    const me = await fetch('/api/auth/me');
    if (me.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    const data = await me.json();
    // Show logged-in user in topbar
    const userEl = document.getElementById('topbarUser');
    if (userEl && data.username) userEl.textContent = data.username;
  } catch {
    // Server unreachable — still try to load
  }

  updateStatus();
  updateConsoleLink();
  setInterval(updateStatus, 30_000);
  onHashChange();
})();

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTs(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
