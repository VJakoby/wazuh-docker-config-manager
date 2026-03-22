import { apiFetch, toast, showConfirm } from './app.js';

let refreshTimer = null;

// ---------------------------------------------------------------------------
// Page init
// ---------------------------------------------------------------------------

export function initContainersPage() {
  replaceWithClone('containersRefreshBtn').addEventListener('click', loadContainers);

  // Auto-refresh every 10s while on this page
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadContainers, 10_000);

  loadContainers();
}

// Stop auto-refresh when leaving the page
export function destroyContainersPage() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

function replaceWithClone(id) {
  const el = document.getElementById(id);
  if (!el) return { addEventListener: () => {} };
  const clone = el.cloneNode(true);
  el.replaceWith(clone);
  return clone;
}

// ---------------------------------------------------------------------------
// Load containers
// ---------------------------------------------------------------------------

async function loadContainers() {
  try {
    const data = await apiFetch('/api/containers');
    renderContainers(data.containers || []);
  } catch (err) {
    toast(`Failed to load containers: ${err.message}`, 'error');
  }
}

function renderContainers(containers) {
  const grid = document.getElementById('containersGrid');
  grid.innerHTML = '';

  if (!containers.length) {
    grid.innerHTML = '<div style="color:var(--muted);font-size:12px">No Wazuh containers found.</div>';
    return;
  }

  containers.forEach(c => {
    const isRunning = c.state === 'running';
    const card = document.createElement('div');
    card.className = 'container-card';
    card.innerHTML = `
      <div class="container-card-header">
        <div class="container-card-name">${escHtml(c.name)}</div>
        <span class="container-status-badge ${isRunning ? 'cs-running' : 'cs-stopped'}">
          ${isRunning ? '● running' : '○ stopped'}
        </span>
      </div>
      <div class="container-card-image">${escHtml(c.image)}</div>
      <div class="container-card-status">${escHtml(c.status)}</div>
      <div class="container-card-id">ID: ${escHtml(c.id)}</div>
      <div class="container-card-actions">
        ${isRunning ? `
          <button class="btn btn-ghost btn-sm container-action" data-name="${escHtml(c.name)}" data-action="restart">↺ Restart</button>
          <button class="btn btn-danger btn-sm container-action" data-name="${escHtml(c.name)}" data-action="stop">■ Stop</button>
        ` : `
          <button class="btn btn-primary btn-sm container-action" data-name="${escHtml(c.name)}" data-action="start">▶ Start</button>
        `}
      </div>
    `;

    card.querySelectorAll('.container-action').forEach(btn => {
      btn.addEventListener('click', () => handleAction(btn.dataset.name, btn.dataset.action));
    });

    grid.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleAction(name, action) {
  const labels = { restart: 'Restart', stop: 'Stop', start: 'Start' };

  if (action === 'stop') {
    const confirmed = await showConfirm(
      `Stop container`,
      `Stop "${name}"? This will take it offline until manually started.`
    );
    if (!confirmed) return;
  }

  if (action === 'restart') {
    const confirmed = await showConfirm(
      `Restart container`,
      `Restart "${name}"? It will be briefly unavailable.`
    );
    if (!confirmed) return;
  }

  try {
    await apiFetch(`/api/containers/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
    toast(`${labels[action]} sent to "${name}"`, 'success');
    // Wait a moment then refresh
    setTimeout(loadContainers, 2000);
  } catch (err) {
    toast(`Failed to ${action} "${name}": ${err.message}`, 'error');
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
