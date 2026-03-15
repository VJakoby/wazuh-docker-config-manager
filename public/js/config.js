import { apiFetch, toast } from './app.js';

let editor = null;

// ---------------------------------------------------------------------------
// Page init
// ---------------------------------------------------------------------------

export async function initConfigPage() {
  replaceWithClone('configSaveBtn').addEventListener('click', handleSave);
  replaceWithClone('configReloadBtn').addEventListener('click', handleReload);

  await Promise.all([loadConfig(), loadStatus()]);
}

function replaceWithClone(id) {
  const el = document.getElementById(id);
  if (!el) return { addEventListener: () => {} };
  const clone = el.cloneNode(true);
  el.replaceWith(clone);
  return clone;
}

// ---------------------------------------------------------------------------
// Load ossec.conf into CodeMirror
// ---------------------------------------------------------------------------

async function loadConfig() {
  try {
    const data = await apiFetch('/api/config/ossec');

    const wrapper = document.getElementById('configEditorWrapper');
    wrapper.innerHTML = '';
    const ta = document.createElement('textarea');
    wrapper.appendChild(ta);

    if (editor) {
      window.__cmEditors = (window.__cmEditors || []).filter(e => e !== editor);
      editor.toTextArea();
      editor = null;
    }

    const cmTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dracula';
    editor = CodeMirror.fromTextArea(ta, {
      mode: 'xml',
      theme: cmTheme,
      lineNumbers: true,
      autoCloseTags: true,
      matchBrackets: true,
      indentUnit: 2,
      tabSize: 2,
      lineWrapping: false,
    });

    window.__cmEditors = window.__cmEditors || [];
    window.__cmEditors.push(editor);

    editor.setValue(data.content || '');
    editor.clearHistory();
  } catch (err) {
    toast(`Failed to load ossec.conf: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Load status cards
// ---------------------------------------------------------------------------

async function loadStatus() {
  try {
    const data = await apiFetch('/api/config/status');
    renderStatusCards(data);
  } catch {
    // Non-critical
  }
}

function renderStatusCards(data) {
  const container = document.getElementById('statusCards');
  if (!container) return;

  const cards = [];

  if (data.container) {
    cards.push({ label: 'Container',  value: data.container.name,   cls: 'ok' });
    cards.push({ label: 'Status',     value: data.container.status, cls: data.container.status === 'running' ? 'ok' : 'warn' });
  }
  if (data.info) {
    cards.push({ label: 'Version',  value: data.info.version  || '—', cls: '' });
    cards.push({ label: 'Hostname', value: data.info.hostname || '—', cls: '' });
  }
  if (data.status) {
    const wazuhd = data.status?.wazuh || {};
    cards.push({ label: 'Manager', value: wazuhd.status || '—', cls: wazuhd.status === 'running' ? 'ok' : 'warn' });
  }

  container.innerHTML = cards.map(c => `
    <div class="status-card">
      <div class="status-card-label">${c.label}</div>
      <div class="status-card-value ${c.cls}">${c.value}</div>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

async function handleSave() {
  if (!editor) return;
  const btn = document.getElementById('configSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await apiFetch('/api/config/ossec', {
      method: 'PUT',
      body: { content: editor.getValue() },
    });
    toast('ossec.conf saved — reload the manager to apply changes', 'success', 5000);
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ---------------------------------------------------------------------------
// Reload manager
// ---------------------------------------------------------------------------

async function handleReload() {
  const btn = document.getElementById('configReloadBtn');
  btn.disabled = true;
  btn.textContent = '↻ Reloading…';
  try {
    await apiFetch('/api/config/reload', { method: 'POST' });
    toast('Wazuh manager reloaded', 'success');
    await loadStatus();
  } catch (err) {
    toast(`Reload failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '↺ Reload Manager';
  }
}
