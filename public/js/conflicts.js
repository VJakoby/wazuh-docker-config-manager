import { apiFetch, toast } from './app.js';

let scanning = false;

// ---------------------------------------------------------------------------
// Page init
// ---------------------------------------------------------------------------

export function initConflictsPage() {
  replaceWithClone('conflictsScanBtn').addEventListener('click', runScan);
  document.getElementById('conflictsResults').innerHTML = '';
  document.getElementById('conflictsSummary').textContent = '';
  runScan();
}

function replaceWithClone(id) {
  const el = document.getElementById(id);
  if (!el) return { addEventListener: () => {} };
  const clone = el.cloneNode(true);
  el.replaceWith(clone);
  return clone;
}

// ---------------------------------------------------------------------------
// Run scan
// ---------------------------------------------------------------------------

async function runScan() {
  if (scanning) return;
  scanning = true;

  const btn     = document.getElementById('conflictsScanBtn');
  const summary = document.getElementById('conflictsSummary');
  const results = document.getElementById('conflictsResults');

  btn.disabled    = true;
  btn.textContent = 'Scanning…';
  summary.textContent = '';
  results.innerHTML = '<div class="conflicts-scanning">Scanning all rule files… this may take a moment.</div>';

  try {
    const data = await apiFetch('/api/conflicts');
    renderReport(data);
  } catch (err) {
    results.innerHTML = `<div class="conflicts-error">Scan failed: ${escHtml(err.message)}</div>`;
    toast(`Scan failed: ${err.message}`, 'error');
  } finally {
    scanning         = false;
    btn.disabled     = false;
    btn.textContent  = '↺ Re-scan';
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderReport(data) {
  const { conflicts, overrides, summary } = data;
  const summaryEl = document.getElementById('conflictsSummary');
  const resultsEl = document.getElementById('conflictsResults');

  // Summary bar
  if (!summary.hasIssues) {
    summaryEl.innerHTML = `<span class="conflicts-all-clear">✓ No conflicts found — ${summary.totalCustomIds} custom IDs, ${summary.totalDefaultIds} default IDs scanned</span>`;
    resultsEl.innerHTML = '';
    return;
  }

  summaryEl.innerHTML = `
    ${conflicts.length ? `<span class="conflicts-badge badge-conflict">${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''}</span>` : ''}
    ${overrides.length ? `<span class="conflicts-badge badge-override">${overrides.length} override${overrides.length !== 1 ? 's' : ''}</span>` : ''}
    <span class="conflicts-scanned">${summary.totalCustomIds} custom IDs · ${summary.totalDefaultIds} default IDs scanned</span>
  `;

  let html = '';

  if (conflicts.length) {
    html += `<div class="conflicts-section">
      <div class="conflicts-section-title conflict-title">
        🔴 Conflicts — same rule ID in multiple custom files
      </div>
      <div class="conflicts-desc">These are almost certainly bugs. Only one rule with a given ID will fire — the other will be silently ignored.</div>
      ${conflicts.map(c => renderIssue(c, 'conflict')).join('')}
    </div>`;
  }

  if (overrides.length) {
    html += `<div class="conflicts-section">
      <div class="conflicts-section-title override-title">
        🟡 Overrides — custom rules shadowing default Wazuh rules
      </div>
      <div class="conflicts-desc">These may be intentional. Wazuh allows custom rules to override defaults by using the same ID. Review to confirm.</div>
      ${overrides.map(c => renderIssue(c, 'override')).join('')}
    </div>`;
  }

  resultsEl.innerHTML = html;
}

function renderIssue(issue, type) {
  if (type === 'conflict') {
    return `
      <div class="conflict-item conflict-item--conflict">
        <div class="conflict-item-header">
          <span class="conflict-id">Rule ID ${escHtml(issue.id)}</span>
        </div>
        <div class="conflict-item-detail">
          Defined in <span class="conflict-file custom-file">${escHtml(issue.files[0])}</span>
          and <span class="conflict-file custom-file">${escHtml(issue.files[1])}</span>
        </div>
        <div class="conflict-item-hint">Only one will be active — remove the duplicate or change one of the IDs.</div>
      </div>`;
  }

  return `
    <div class="conflict-item conflict-item--override">
      <div class="conflict-item-header">
        <span class="conflict-id">Rule ID ${escHtml(issue.id)}</span>
      </div>
      <div class="conflict-item-detail">
        Custom file <span class="conflict-file custom-file">${escHtml(issue.customFile)}</span>
        overrides default <span class="conflict-file default-file">${escHtml(issue.defaultFile)}</span>
      </div>
      <div class="conflict-item-hint">If intentional, no action needed. If not, change the custom rule ID to something above 100000.</div>
    </div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---------------------------------------------------------------------------
// Export for use in rules.js (pre-save check)
// ---------------------------------------------------------------------------

/**
 * Check a single file's content for conflicts before saving.
 * Returns { issues: [...] } — empty array means no issues.
 */
export async function checkFileConflicts(content, filename, source) {
  try {
    const data = await apiFetch('/api/conflicts/check', {
      method: 'POST',
      body: { content, filename, source },
    });
    return data;
  } catch {
    return { issues: [] }; // fail silently — don't block saving
  }
}
