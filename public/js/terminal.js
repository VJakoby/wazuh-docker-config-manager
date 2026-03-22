let term      = null;
let fitAddon  = null;
let ws        = null;
let resizeObs = null;

// ---------------------------------------------------------------------------
// Page init
// ---------------------------------------------------------------------------

export function initTerminalPage() {
  const wrap = document.getElementById('terminalWrap');

  // Update target label
  const connLabel = document.getElementById('connLabel');
  const targetEl  = document.getElementById('terminalTarget');
  if (connLabel && targetEl && connLabel.textContent !== 'connecting…') {
    targetEl.textContent = connLabel.textContent;
  }

  replaceWithClone('terminalReconnectBtn').addEventListener('click', () => {
    disconnect();
    setTimeout(() => connect(wrap), 300);
  });

  // Tear down any previous instance
  if (term) { term.dispose(); term = null; fitAddon = null; }
  disconnect();

  connect(wrap);
}

function replaceWithClone(id) {
  const el = document.getElementById(id);
  if (!el) return { addEventListener: () => {} };
  const clone = el.cloneNode(true);
  el.replaceWith(clone);
  return clone;
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

function connect(wrap) {
  term = new Terminal({
    fontFamily:       "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
    fontSize:         13,
    lineHeight:       1.4,
    cursorBlink:      true,
    convertEol:       true,
    scrollback:       5000,
    allowProposedApi: true,
    theme:            buildTheme(),
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  wrap.innerHTML = '';
  term.open(wrap);

  // Fit after a short delay to ensure the DOM has settled
  setTimeout(() => { try { fitAddon.fit(); } catch { /* ignore */ } }, 50);

  term.writeln('\x1b[90mConnecting…\x1b[0m');

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/terminal`);

  ws.onopen = () => {
    console.log('[terminal] WebSocket connected');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'ready') {
        // Server shell is open — clear the "Connecting…" line and send size
        term.clear();
        sendResize();
        return;
      }

      if (msg.type === 'output') {
        // Data was sent as binary string — write directly
        term.write(msg.data);
        return;
      }

      if (msg.type === 'exit') {
        term.writeln('\r\n\x1b[90m[session ended — press Reconnect to start a new one]\x1b[0m');
        return;
      }

      if (msg.type === 'error') {
        term.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
      }
    } catch {
      // Not JSON — write raw
      term.write(event.data);
    }
  };

  ws.onclose = () => {
    if (term) term.writeln('\r\n\x1b[90m[disconnected]\x1b[0m');
  };

  ws.onerror = (e) => {
    if (term) term.writeln('\r\n\x1b[31m[connection error]\x1b[0m');
    console.error('[terminal] WebSocket error', e);
  };

  // User input → server
  term.onData(data => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  });

  // Terminal resize → server
  term.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });

  // Watch container for size changes
  if (resizeObs) resizeObs.disconnect();
  resizeObs = new ResizeObserver(() => {
    if (fitAddon && term) {
      try { fitAddon.fit(); } catch { /* ignore */ }
    }
  });
  resizeObs.observe(wrap);
}

function sendResize() {
  if (!term || !fitAddon) return;
  try {
    fitAddon.fit();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

function disconnect() {
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function buildTheme() {
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  return dark ? {
    background:  '#0d0d0d', foreground:  '#c9d1e0', cursor: '#5b8dee',
    black: '#1a1d26', red: '#f85149', green: '#3fb950', yellow: '#d29922',
    blue: '#5b8dee', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c9d1e0',
    brightBlack: '#3a3f55', brightWhite: '#ffffff',
  } : {
    background:  '#ffffff', foreground: '#1e2030', cursor: '#2563eb',
    black: '#f0f1f4', red: '#dc2626', green: '#16a34a', yellow: '#b45309',
    blue: '#2563eb', magenta: '#7c3aed', cyan: '#0891b2', white: '#1e2030',
    brightBlack: '#9ca3af', brightWhite: '#000000',
  };
}

export function updateTerminalTheme() {
  if (term) term.options.theme = buildTheme();
}