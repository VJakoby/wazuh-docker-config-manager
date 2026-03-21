import { apiFetch, toast, showConfirm, showNewFileModal } from './app.js';

let editor      = null;
let currentFile = null;
let currentType = null;
let allFiles    = [];
let ltHistory   = [];  // logtest history, newest first

const DEFAULT_RULE = `<group name="local,">

  <rule id="100001" level="3">
    <if_sid></if_sid>
    <description>Custom rule description</description>
  </rule>

</group>
`;

const DEFAULT_DECODER = `<decoder name="custom-decoder">
  <prematch>your_log_prefix</prematch>
  <regex>your_regex_pattern</regex>
  <order>field1, field2</order>
</decoder>
`;

// ---------------------------------------------------------------------------
// Page init
// ---------------------------------------------------------------------------

export function initRulesPage(type) {
  if (currentType !== type) {
    currentFile = null;
    if (editor) {
      window.__cmEditors = (window.__cmEditors || []).filter(e => e !== editor);
      editor.toTextArea();
      editor = null;
    }
    const wrapper = document.getElementById('editorWrapper');
    if (wrapper) wrapper.innerHTML = '<div class="editor-placeholder">← select a file to edit</div>';
    document.getElementById('editorFilename').textContent     = 'select a file';
    document.getElementById('editorActions').style.display   = 'none';
    document.getElementById('logtestPanel').style.display    = 'none';
    document.getElementById('hFile').textContent             = 'select a file';
  }

  currentType = type;
  document.getElementById('filesPanelLabel').textContent = type === 'decoders' ? 'Decoders' : 'Rules';

  replaceWithClone('newFileBtn').addEventListener('click', () => handleNewFile(type));
  replaceWithClone('saveFileBtn').addEventListener('click', handleSave);
  replaceWithClone('deleteFileBtn').addEventListener('click', handleDelete);
  replaceWithClone('logtestToggleBtn').addEventListener('click', toggleLogtest);
  replaceWithClone('logtestCloseBtn').addEventListener('click', () => {
    document.getElementById('logtestPanel').style.display = 'none';
  });
  replaceWithClone('logtestRunBtn').addEventListener('click', runLogtest);
  replaceWithClone('logtestClearBtn').addEventListener('click', clearHistory);

  document.getElementById('logtestInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') runLogtest();
  });
  document.getElementById('fileSearch').addEventListener('input', e => {
    renderFileList(allFiles.filter(f => f.includes(e.target.value)));
  });

  loadFiles(type);
}

function replaceWithClone(id) {
  const el = document.getElementById(id);
  if (!el) return { addEventListener: () => {} };
  const clone = el.cloneNode(true);
  el.replaceWith(clone);
  return clone;
}

// ---------------------------------------------------------------------------
// File list
// ---------------------------------------------------------------------------

async function loadFiles(type) {
  try {
    const data = await apiFetch(`/api/${type}`);
    allFiles = data.files || [];
    renderFileList(allFiles);
  } catch (err) {
    toast(`Failed to load ${type}: ${err.message}`, 'error');
  }
}

function renderFileList(files) {
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  if (!files.length) {
    const empty = document.createElement('li');
    empty.style.cssText = 'padding:10px 14px;color:var(--muted);font-size:11px';
    empty.textContent = 'No files found';
    list.appendChild(empty);
    return;
  }
  files.forEach(filename => {
    const li = document.createElement('li');
    li.className = 'file-list-item' + (filename === currentFile ? ' active' : '');
    li.textContent = filename;
    li.addEventListener('click', () => openFile(filename));
    list.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// Open file
// ---------------------------------------------------------------------------

async function openFile(filename) {
  try {
    const data = await apiFetch(`/api/${currentType}/${encodeURIComponent(filename)}`);
    currentFile = filename;
    document.getElementById('editorFilename').textContent   = filename;
    document.getElementById('editorActions').style.display = 'flex';
    document.getElementById('hFile').textContent           = filename;

    const wrapper = document.getElementById('editorWrapper');
    wrapper.innerHTML = '';
    const ta = document.createElement('textarea');
    wrapper.appendChild(ta);

    if (editor) {
      window.__cmEditors = (window.__cmEditors || []).filter(e => e !== editor);
      editor.toTextArea();
    }

    const cmTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dracula';
    editor = CodeMirror.fromTextArea(ta, {
      mode: 'xml', theme: cmTheme, lineNumbers: true,
      autoCloseTags: true, matchBrackets: true,
      indentUnit: 2, tabSize: 2, lineWrapping: false,
    });
    window.__cmEditors = window.__cmEditors || [];
    window.__cmEditors.push(editor);
    editor.setValue(data.content || '');
    editor.clearHistory();
    editor.focus();

    document.querySelectorAll('#fileList .file-list-item').forEach(el => {
      el.classList.toggle('active', el.textContent === filename);
    });
  } catch (err) {
    toast(`Failed to open ${filename}: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Save / New / Delete
// ---------------------------------------------------------------------------

async function handleSave() {
  if (!editor || !currentFile) return;
  const btn = document.getElementById('saveFileBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await apiFetch(`/api/${currentType}/${encodeURIComponent(currentFile)}`, {
      method: 'PUT', body: { content: editor.getValue() },
    });
    toast(`${currentFile} saved`, 'success');
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

async function handleNewFile(type) {
  const name = await showNewFileModal(type);
  if (!name) return;
  const filename = name.endsWith('.xml') ? name : `${name}.xml`;
  const content  = type === 'decoders' ? DEFAULT_DECODER : DEFAULT_RULE;
  try {
    await apiFetch(`/api/${type}/${encodeURIComponent(filename)}`, {
      method: 'PUT', body: { content },
    });
    toast(`Created ${filename}`, 'success');
    await loadFiles(type);
    openFile(filename);
  } catch (err) {
    toast(`Failed to create file: ${err.message}`, 'error');
  }
}

async function handleDelete() {
  if (!currentFile) return;
  const confirmed = await showConfirm('Delete file', `Delete "${currentFile}"? This cannot be undone.`);
  if (!confirmed) return;
  try {
    await apiFetch(`/api/${currentType}/${encodeURIComponent(currentFile)}`, { method: 'DELETE' });
    toast(`${currentFile} deleted`, 'success');
    currentFile = null;
    document.getElementById('editorFilename').textContent   = 'select a file';
    document.getElementById('editorActions').style.display = 'none';
    document.getElementById('hFile').textContent           = 'select a file';
    document.getElementById('editorWrapper').innerHTML     = '<div class="editor-placeholder">← select a file to edit</div>';
    document.getElementById('logtestPanel').style.display = 'none';
    if (editor) {
      window.__cmEditors = (window.__cmEditors || []).filter(e => e !== editor);
      editor.toTextArea(); editor = null;
    }
    await loadFiles(currentType);
  } catch (err) {
    toast(`Delete failed: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Log tester
// ---------------------------------------------------------------------------

function toggleLogtest() {
  const panel = document.getElementById('logtestPanel');
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'flex';
  if (!visible) document.getElementById('logtestInput').focus();
}

async function runLogtest() {
  const input  = document.getElementById('logtestInput');
  const log    = input.value.trim();
  if (!log) return;

  const runBtn = document.getElementById('logtestRunBtn');
  runBtn.disabled = true;
  runBtn.textContent = 'Running…';

  try {
    const data = await apiFetch('/api/rules/actions/logtest', {
      method: 'POST', body: { log },
    });

    ltHistory.unshift({ log, result: data.parsed, raw: data.raw, ts: new Date() });
    if (ltHistory.length > 10) ltHistory.pop();
    input.value = '';
    renderHistory();
  } catch (err) {
    toast(`Logtest error: ${err.message}`, 'error');
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = 'Run';
  }
}

function clearHistory() {
  ltHistory = [];
  renderHistory();
}

function renderHistory() {
  const container = document.getElementById('logtestHistory');
  if (!container) return;

  if (!ltHistory.length) {
    container.innerHTML = '<div class="lt-empty">No tests run yet.</div>';
    return;
  }
  container.innerHTML = ltHistory.map(entry => renderEntry(entry)).join('');
}

function renderEntry(entry) {
  const { log, result, ts } = entry;
  const time = ts.toLocaleTimeString();

  if (result.error && !result.rule.id) {
    return `
      <div class="lt-entry lt-entry--miss">
        <div class="lt-entry-header">
          <span class="lt-entry-log" title="${escHtml(log)}">${escHtml(truncate(log, 80))}</span>
          <span class="lt-entry-time">${time}</span>
        </div>
        <div class="lt-entry-error">${escHtml(result.error)}</div>
      </div>`;
  }

  const level      = result.rule.level || 0;
  const levelClass = level >= 12 ? 'lt-level--high' : level >= 7 ? 'lt-level--med' : 'lt-level--low';

  const rows = (obj) => Object.entries(obj || {})
    .map(([k, v]) => `<tr><td class="lt-key">${escHtml(k)}</td><td>${escHtml(String(v))}</td></tr>`)
    .join('');

  const preRows  = rows(result.predecoding);
  const decRows  = rows(result.decoding);
  const ruleRows = rows(result.rule);

  return `
    <div class="lt-entry lt-entry--match">
      <div class="lt-entry-header">
        <span class="lt-entry-log" title="${escHtml(log)}">${escHtml(truncate(log, 80))}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="lt-level ${levelClass}">lvl ${level}</span>
          <span class="lt-entry-time">${time}</span>
        </div>
      </div>
      ${result.rule.description ? `<div class="lt-rule-desc">${escHtml(result.rule.description)}</div>` : ''}
      <div class="lt-sections">
        ${preRows  ? `<div class="lt-section"><div class="lt-section-title">Pre-decoding</div><table class="lt-table">${preRows}</table></div>`  : ''}
        ${decRows  ? `<div class="lt-section"><div class="lt-section-title">Decoding</div><table class="lt-table">${decRows}</table></div>`      : ''}
        ${ruleRows ? `<div class="lt-section"><div class="lt-section-title">Rule</div><table class="lt-table">${ruleRows}</table></div>`         : ''}
      </div>
    </div>`;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}
