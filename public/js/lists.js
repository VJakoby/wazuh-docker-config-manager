import { apiFetch, toast, showConfirm } from './app.js';

let currentList    = null;
let currentEntries = [];

// ---------------------------------------------------------------------------
// Page init
// ---------------------------------------------------------------------------

export function initListsPage() {
  replaceWithClone('newListBtn').addEventListener('click', handleNewList);
  replaceWithClone('listSaveBtn').addEventListener('click', handleSave);
  replaceWithClone('listAddEntryBtn').addEventListener('click', () => addEntryRow('', ''));
  replaceWithClone('listDeleteBtn').addEventListener('click', handleDeleteList);

  document.getElementById('listSearch').addEventListener('input', e => {
    filterEntries(e.target.value);
  });

  document.getElementById('listFileSearch').addEventListener('input', e => {
    filterListFiles(e.target.value);
  });

  // Reset editor
  showEditor(false);
  loadLists();
}

function replaceWithClone(id) {
  const el = document.getElementById(id);
  if (!el) return { addEventListener: () => {} };
  const clone = el.cloneNode(true);
  el.replaceWith(clone);
  return clone;
}

// ---------------------------------------------------------------------------
// Load list files
// ---------------------------------------------------------------------------

async function loadLists() {
  try {
    const data = await apiFetch('/api/lists');
    renderListFiles(data.lists || []);
  } catch (err) {
    toast(`Failed to load CDB lists: ${err.message}`, 'error');
  }
}

function renderListFiles(files) {
  const ul = document.getElementById('listFileList');
  ul.innerHTML = '';
  if (!files.length) {
    ul.innerHTML = '<li style="padding:10px 14px;color:var(--muted);font-size:11px">No lists found</li>';
    return;
  }
  files.forEach(name => {
    const li = document.createElement('li');
    li.className = 'file-list-item' + (name === currentList ? ' active' : '');
    li.textContent = name;
    li.addEventListener('click', () => openList(name));
    ul.appendChild(li);
  });
}

function filterListFiles(query) {
  document.querySelectorAll('#listFileList .file-list-item').forEach(li => {
    li.style.display = li.textContent.toLowerCase().includes(query.toLowerCase()) ? '' : 'none';
  });
}

// ---------------------------------------------------------------------------
// Open a list
// ---------------------------------------------------------------------------

async function openList(name) {
  try {
    const data = await apiFetch(`/api/lists/${encodeURIComponent(name)}`);
    currentList    = name;
    currentEntries = data.entries || [];

    document.getElementById('listEditorTitle').textContent = name;
    document.getElementById('hFile').textContent           = name;
    showEditor(true);
    renderEntries(currentEntries);

    document.querySelectorAll('#listFileList .file-list-item').forEach(li => {
      li.classList.toggle('active', li.textContent === name);
    });
  } catch (err) {
    toast(`Failed to open ${name}: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Render entries table
// ---------------------------------------------------------------------------

function renderEntries(entries) {
  const tbody = document.getElementById('listEntriesBody');
  tbody.innerHTML = '';
  entries.forEach((entry, i) => addEntryRow(entry.key, entry.value, i));
  updateEntryCount();
}

function addEntryRow(key = '', value = '', index = null) {
  const tbody = document.getElementById('listEntriesBody');
  const tr    = document.createElement('tr');
  tr.className = 'list-entry-row';
  tr.innerHTML = `
    <td><input class="input input-sm entry-key" value="${escHtml(key)}" placeholder="key" /></td>
    <td><input class="input input-sm entry-value" value="${escHtml(value)}" placeholder="value (optional)" /></td>
    <td><button class="btn-remove entry-delete" title="Remove entry">✕</button></td>
  `;
  tr.querySelector('.entry-delete').addEventListener('click', () => {
    tr.remove();
    updateEntryCount();
  });
  tbody.appendChild(tr);
  if (key === '') tr.querySelector('.entry-key').focus();
  updateEntryCount();
}

function updateEntryCount() {
  const count = document.getElementById('listEntriesBody').querySelectorAll('tr').length;
  const el    = document.getElementById('listEntryCount');
  if (el) el.textContent = `${count} entr${count !== 1 ? 'ies' : 'y'}`;
}

function filterEntries(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('#listEntriesBody .list-entry-row').forEach(row => {
    const key = row.querySelector('.entry-key')?.value || '';
    const val = row.querySelector('.entry-value')?.value || '';
    row.style.display = (key + val).toLowerCase().includes(q) ? '' : 'none';
  });
}

function collectEntries() {
  const rows = document.querySelectorAll('#listEntriesBody .list-entry-row');
  const entries = [];
  rows.forEach(row => {
    const key   = row.querySelector('.entry-key')?.value.trim()   || '';
    const value = row.querySelector('.entry-value')?.value.trim() || '';
    if (key) entries.push({ key, value });
  });
  return entries;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

async function handleSave() {
  if (!currentList) return;
  const btn     = document.getElementById('listSaveBtn');
  const entries = collectEntries();
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await apiFetch(`/api/lists/${encodeURIComponent(currentList)}`, {
      method: 'PUT', body: { entries },
    });
    currentEntries = entries;
    toast(`${currentList} saved (${entries.length} entries)`, 'success');
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

// ---------------------------------------------------------------------------
// New list
// ---------------------------------------------------------------------------

async function handleNewList() {
  const name = prompt('List name:');
  if (!name || !name.trim()) return;
  try {
    await apiFetch('/api/lists', { method: 'POST', body: { name: name.trim() } });
    toast(`Created ${name}`, 'success');
    await loadLists();
    openList(name.trim());
  } catch (err) {
    toast(`Failed to create list: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Delete list
// ---------------------------------------------------------------------------

async function handleDeleteList() {
  if (!currentList) return;
  const confirmed = await showConfirm('Delete list', `Delete "${currentList}"? This cannot be undone.`);
  if (!confirmed) return;
  try {
    await apiFetch(`/api/lists/${encodeURIComponent(currentList)}`, { method: 'DELETE' });
    toast(`${currentList} deleted`, 'success');
    currentList    = null;
    currentEntries = [];
    showEditor(false);
    document.getElementById('hFile').textContent = '';
    await loadLists();
  } catch (err) {
    toast(`Delete failed: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showEditor(visible) {
  const editor = document.getElementById('listEditor');
  if (editor) editor.style.display = visible ? 'flex' : 'none';
  const placeholder = document.getElementById('listPlaceholder');
  if (placeholder) placeholder.style.display = visible ? 'none' : 'flex';
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
