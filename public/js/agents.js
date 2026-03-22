import { apiFetch, toast, showConfirm } from './app.js';

let allAgents    = [];
let enrollData   = null;
let groupEditor  = null;  // CodeMirror for group agent.conf
let currentGroup = null;

// ---------------------------------------------------------------------------
// Page init
// ---------------------------------------------------------------------------

export async function initAgentsPage() {
  replaceWithClone('enrollAgentBtn').addEventListener('click', toggleEnrollPanel);
  replaceWithClone('enrollSubmitBtn').addEventListener('click', handleEnroll);
  replaceWithClone('enrollCopyBtn').addEventListener('click', handleCopyCommands);

  document.getElementById('agentSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderAgents(allAgents.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.ip   || '').toLowerCase().includes(q) ||
      String(a.id).includes(q)
    ));
  });

  document.querySelectorAll('.os-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.os-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderEnrollCommands(tab.dataset.os);
    });
  });

  // Group config editor buttons
  replaceWithClone('groupConfigSaveBtn').addEventListener('click', handleGroupConfigSave);
  replaceWithClone('groupConfigCloseBtn').addEventListener('click', closeGroupConfig);

  document.getElementById('enrollPanel').style.display      = 'none';
  document.getElementById('enrollResult').style.display     = 'none';
  document.getElementById('groupConfigPanel').style.display = 'none';

  await Promise.all([loadAgents(), loadGroupsIntoSelect(), loadGroupsList()]);
}

function replaceWithClone(id) {
  const el = document.getElementById(id);
  if (!el) return { addEventListener: () => {} };
  const clone = el.cloneNode(true);
  el.replaceWith(clone);
  return clone;
}

// ---------------------------------------------------------------------------
// Agents
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
  if (!agents.length) { if (empty) empty.style.display = 'block'; return; }
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
// Enroll
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
      opt.value = g.name; opt.textContent = g.name;
      select.appendChild(opt);
    });
  } catch { /* non-critical */ }
}

async function handleEnroll() {
  const name  = document.getElementById('enrollName').value.trim();
  const ip    = document.getElementById('enrollIP').value.trim() || 'any';
  const group = document.getElementById('enrollGroup').value;
  if (!name) { toast('Agent name is required', 'error'); return; }

  const btn = document.getElementById('enrollSubmitBtn');
  btn.disabled = true; btn.textContent = 'Generating…';
  try {
    const data = await apiFetch('/api/agents/enroll', { method: 'POST', body: { name, ip, group } });
    enrollData = data;
    document.getElementById('enrollResult').style.display = 'block';
    document.querySelectorAll('.os-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    renderEnrollCommands('linux');
    toast(`Agent "${name}" enrollment info generated`, 'success');
    await loadAgents();
  } catch (err) {
    toast(`Enrollment failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Generate';
  }
}

function renderEnrollCommands(os) {
  if (!enrollData) return;
  document.getElementById('enrollCommands').textContent = enrollData.commands?.[os] || '(no commands for this OS)';
  const labels = { linux: 'install-linux.sh', windows: 'install-windows.ps1', macos: 'install-macos.sh' };
  const labelEl = document.getElementById('enrollCommandsLabel');
  if (labelEl) labelEl.textContent = labels[os] || 'install-commands.sh';
  // Reset copy button
  const btn = document.getElementById('enrollCopyBtn');
  if (btn) { btn.textContent = 'Copy'; btn.style.color = ''; }
}

async function handleCopyCommands() {
  const btn  = document.getElementById('enrollCopyBtn');
  const text = document.getElementById('enrollCommands').textContent;
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      btn.textContent = '✓ Copied';
      btn.style.color = 'var(--green)';
      setTimeout(() => { btn.textContent = 'Copy'; btn.style.color = ''; }, 2000);
    }
  } catch {
    toast('Copy failed — select and copy manually', 'error');
  }
}

// ---------------------------------------------------------------------------
// Groups list
// ---------------------------------------------------------------------------

async function loadGroupsList() {
  try {
    const data = await apiFetch('/api/agents/groups/list');
    renderGroupsList(data.groups || []);
  } catch (err) {
    toast(`Failed to load groups: ${err.message}`, 'error');
  }
}

function renderGroupsList(groups) {
  const tbody = document.getElementById('groupsBody');
  const empty = document.getElementById('groupsEmpty');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!groups.length) { if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';

  groups.forEach(g => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="name">${g.name}</td>
      <td class="mono">${g.count ?? '—'}</td>
      <td>
        <button class="btn-edit-config" data-group="${escapeHtml(g.name)}" style="padding:3px 8px;border-radius:3px;font-size:11px;background:none;border:1px solid var(--border);color:var(--dim);cursor:pointer;font-family:inherit;transition:all 80ms">edit agent.conf</button>
      </td>
    `;
    tr.querySelector('.btn-edit-config').addEventListener('click', (e) => {
      openGroupConfig(e.target.dataset.group);
    });
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------------------------
// Group config editor
// ---------------------------------------------------------------------------

async function openGroupConfig(groupName) {
  currentGroup = groupName;
  const panel  = document.getElementById('groupConfigPanel');
  const title  = document.getElementById('groupConfigTitle');
  const wrapper = document.getElementById('groupConfigEditorWrapper');

  title.textContent    = `agent.conf — ${groupName}`;
  panel.style.display  = 'block';
  wrapper.innerHTML    = '<div style="padding:14px;color:var(--muted);font-size:12px">Loading…</div>';

  try {
    const data = await apiFetch(`/api/agents/groups/${encodeURIComponent(groupName)}/config`);

    wrapper.innerHTML = '';
    const ta = document.createElement('textarea');
    wrapper.appendChild(ta);

    if (groupEditor) {
      window.__cmEditors = (window.__cmEditors || []).filter(e => e !== groupEditor);
      groupEditor.toTextArea();
    }

    const cmTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dracula';
    groupEditor = CodeMirror.fromTextArea(ta, {
      mode: 'xml', theme: cmTheme, lineNumbers: true,
      autoCloseTags: true, matchBrackets: true,
      indentUnit: 2, tabSize: 2, lineWrapping: false,
    });
    window.__cmEditors = window.__cmEditors || [];
    window.__cmEditors.push(groupEditor);
    groupEditor.setValue(data.content || '');
    groupEditor.clearHistory();

    // Scroll to panel
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    wrapper.innerHTML = `<div style="padding:14px;color:var(--red);font-size:12px">Error: ${err.message}</div>`;
    toast(`Failed to load group config: ${err.message}`, 'error');
  }
}

async function handleGroupConfigSave() {
  if (!groupEditor || !currentGroup) return;
  const btn = document.getElementById('groupConfigSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await apiFetch(`/api/agents/groups/${encodeURIComponent(currentGroup)}/config`, {
      method: 'PUT', body: { content: groupEditor.getValue() },
    });
    toast(`agent.conf for "${currentGroup}" saved`, 'success');
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

function closeGroupConfig() {
  document.getElementById('groupConfigPanel').style.display = 'none';
  if (groupEditor) {
    window.__cmEditors = (window.__cmEditors || []).filter(e => e !== groupEditor);
    groupEditor.toTextArea();
    groupEditor = null;
  }
  currentGroup = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status) {
  const map = {
    active:          ['status-active',       '● active'],
    disconnected:    ['status-disconnected', '○ disconnected'],
    never_connected: ['status-never',        '○ never connected'],
    pending:         ['status-pending',      '◌ pending'],
  };
  const [cls, label] = map[status] || ['status-never', status || '—'];
  return `<span class="status-badge ${cls}">${label}</span>`;
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === '1970-01-01T00:00:00Z') return 'never';
  try { return new Date(dateStr).toLocaleString(); } catch { return dateStr; }
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
