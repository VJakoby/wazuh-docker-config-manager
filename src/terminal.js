'use strict';

const { WebSocketServer } = require('ws');
const docker = require('./docker');

function attachTerminal(httpServer, sessionMiddleware) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/terminal') {
      socket.destroy();
      return;
    }

    const res = { end: () => {}, getHeader: () => {}, setHeader: () => {} };
    sessionMiddleware(req, res, () => {
      if (!req.session?.authenticated) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req);
      });
    });
  });

  wss.on('connection', async (ws, req) => {
    const user = req.session?.username || 'unknown';
    console.log(`[terminal] New session for user "${user}"`);

    let execStream = null;
    let execInstance = null;

    function send(obj) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
      }
    }

    function cleanup() {
      if (execStream) {
        execStream.removeAllListeners();
        try { execStream.destroy(); } catch { /* ignore */ }
        execStream = null;
      }
    }

    try {
      const container = await docker.getContainer();

      execInstance = await container.exec({
        Cmd:          ['/bin/bash'],
        AttachStdin:  true,
        AttachStdout: true,
        AttachStderr: true,
        Tty:          true,
        Env:          ['TERM=xterm-256color', 'PS1=\\u@\\h:\\w\\$ '],
      });

      // With Tty:true, dockerode returns the raw socket via the stream property
      const execStartResult = await execInstance.start({
        hijack: true,
        stdin:  true,
      });

      // dockerode wraps the socket — the actual readable/writable is the stream
      execStream = execStartResult;

      // Attach error handler first — prevents unhandled error events
      execStream.on('error', err => {
        console.error(`[terminal] Stream error for "${user}":`, err.message);
        send({ type: 'error', message: err.message });
        cleanup();
      });

      // With Tty:true the output is raw (no multiplexing headers)
      execStream.on('data', chunk => {
        send({ type: 'output', data: chunk.toString('binary') });
      });

      execStream.on('end', () => {
        console.log(`[terminal] Shell ended for "${user}"`);
        send({ type: 'exit', code: 0 });
        if (ws.readyState === ws.OPEN) ws.close();
        cleanup();
      });

      // Browser → container
      ws.on('message', raw => {
        try {
          const msg = JSON.parse(raw);

          if (msg.type === 'input' && execStream && !execStream.destroyed) {
            execStream.write(msg.data);
          }

          if (msg.type === 'resize' && execInstance) {
            const cols = Math.max(1, msg.cols || 80);
            const rows = Math.max(1, msg.rows || 24);
            execInstance.resize({ w: cols, h: rows }).catch(() => {});
          }
        } catch { /* ignore malformed messages */ }
      });

      ws.on('close', () => {
        console.log(`[terminal] Connection closed for "${user}"`);
        cleanup();
      });

      ws.on('error', err => {
        console.error(`[terminal] WS error for "${user}":`, err.message);
        cleanup();
      });

      // Send initial resize once connected so the shell knows the dimensions
      send({ type: 'ready' });

    } catch (err) {
      console.error(`[terminal] Failed to open shell for "${user}":`, err.message);
      send({ type: 'error', message: `Failed to open shell: ${err.message}` });
      if (ws.readyState === ws.OPEN) ws.close();
    }
  });

  console.log('[terminal] WebSocket terminal attached at ws://…/terminal');
  return wss;
}

module.exports = { attachTerminal };
