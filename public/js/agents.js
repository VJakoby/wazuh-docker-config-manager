import { apiFetch, toast, showConfirm } from './app.js';

let allAgents = [];
let enrollData = null;
let initialized = false;

// ---------------------------------------------------------------------------
// Page init
// ---------------------------------------------------------------------------

export async function initAgentsPage() {
  // Wire up buttons fresh each time (clone to remove stale listeners)
  replaceWithClone('enrollAgentBtn').addEventListener('click', toggleEnrollPanel);
  replaceWithClone('enrollSubmitBtn').addEventListener('click', handleEnroll);
  replaceWithClone('enrollCopyBtn').addEventListener('click', handleCopyCommands);

  document.getElementById('agentSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderAgents(allAgents.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.ip || '').toLowerCase().includes(q) ||
      String(a.id).includes(q)
    ));
  });

  // OS tab switcher
  document.querySelectorAll('.os-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.os-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderEnrollCommands(tab.dataset.os);
    });
  });

  // Hide enroll panel on page init
  document.getElementById('enrollPanel').style.display = 'none';
  document.getElementById('enrollResult').style.display = 'none';

  await Promise.all([loadAgents(), loadGroupsIntoSelect()]);
}

function replaceWithClone(id) {
  const el = document.getElementById(id);
  if (!el) return { addEventListener: () => {} };
  const clone = el.cloneNode(true);
  el.replaceWith(clone);
  return clone;
}

// ---------------------------------------------------------------------------
// Load agents
// ---------------------------------------------------------------------------

async function loadAgents() {
  try {
    const data = await apiFetch('/api/agents');
    allAgents = data.agents || [];
    renderAgents(allAgents);
    const ct = document.getElementById('agentCount');
    if (ct) ct.textContent = `${allAgents.length} agent${allAgents.length !== 1 ? 's' : ''}`;
  } catch (err) {
    toast(`Failed to load agents: ${err.message}`, 'error');
  }
}

function renderAgents(agents) {
  const tbody = document.getElementById('agentsBody');
  const empty = document.getElementById('agentsEmpty');
  tbody.innerHTML = '';

  if (!agents.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  agents.forEach(agent => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${agent.id}</td>
      <td class="name">${agent.name || '—'}</td>
      <td class="mono">${agent.ip || '—'}</td>
      <td>${agent.os?.name ? `${agent.os.name} ${agent.os.version || ''}`.trim() : '—'}</td>
      <td class="mono">${agent.version || '—'}</td>
      <td>${(agent.group || ['default']).join(', ')}</td>
      <td>${statusBadge(agent.status)}</td>
      <td class="mono" style="font-size:11px">${formatDate(agent.lastKeepAlive)}</td>
      <td>${agent.id !== '000' ? `<button class="btn-remove" data-id="${agent.id}" data-name="${escapeHtml(agent.name || '')}">remove</button>` : ''}</td>
    `;

    const btn = tr.querySelector('.btn-remove');
    if (btn) btn.addEventListener('click', () => handleRemoveAgent(btn.dataset.id, btn.dataset.name));

    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------------------------
// Remove agent
// ---------------------------------------------------------------------------

async function handleRemoveAgent(id, name) {
  const confirmed = await showConfirm('Remove agent', `Remove agent "${name}" (ID: ${id})? This cannot be undone.`);
  if (!confirmed) return;

  try {
    await apiFetch(`/api/agents/${id}`, { method: 'DELETE' });
    toast(`Agent "${name}" removed`, 'success');
    await loadAgents();
  } catch (err) {
    toast(`Failed to remove agent: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Enroll panel
// ---------------------------------------------------------------------------

function toggleEnrollPanel() {
  const panel = document.getElementById('enrollPanel');
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (!visible) document.getElementById('enrollName').focus();
}

async function loadGroupsIntoSelect() {
  try {
    const data = await apiFetch('/api/agents/groups/list');
    const select = document.getElementById('enrollGroup');
    select.innerHTML = '';
    (data.groups || []).forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.name;
      opt.textContent = g.name;
      select.appendChild(opt);
    });
  } catch {
    // Non-critical — keep default option
  }
}

async function handleEnroll() {
  const name  = document.getElementById('enrollName').value.trim();
  const ip    = document.getElementById('enrollIP').value.trim() || 'any';
  const group = document.getElementById('enrollGroup').value;

  if (!name) { toast('Agent name is required', 'error'); return; }

  const btn = document.getElementById('enrollSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Generating…';

  try {
    const data = await apiFetch('/api/agents/enroll', {
      method: 'POST',
      body: { name, ip, group },
    });
    enrollData = data;
    document.getElementById('enrollResult').style.display = 'block';
    // Reset to Linux tab
    document.querySelectorAll('.os-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    renderEnrollCommands('linux');
    toast(`Agent "${name}" enrollment info generated`, 'success');
    await loadAgents();
  } catch (err) {
    toast(`Enrollment failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}

function renderEnrollCommands(os) {
  if (!enrollData) return;
  const pre = document.getElementById('enrollCommands');
  pre.textContent = enrollData.commands?.[os] || '(no commands for this OS)';
}

async function handleCopyCommands() {
  const text = document.getElementById('enrollCommands').textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('Commands copied', 'success');
  } catch {
    toast('Copy failed — select and copy manually', 'error');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status) {
  const map = {
    active:           ['status-active',       '● active'],
    disconnected:     ['status-disconnected', '○ disconnected'],
    never_connected:  ['status-never',        '○ never connected'],
    pending:          ['status-pending',      '◌ pending'],
  };
  const [cls, label] = map[status] || ['status-never', status || '—'];
  return `<span class="status-badge ${cls}">${label}</span>`;
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === '1970-01-01T00:00:00Z') return 'never';
  try {
    return new Date(dateStr).toLocaleString();
  } catch { return dateStr; }
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
