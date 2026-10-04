// shellbook v0.1 — Shell 通道 MVP：單一全域 pty + websocket + static 前端
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const WORKSPACE = path.join(__dirname, 'workspace');
fs.mkdirSync(WORKSPACE, { recursive: true });

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: 'v0.1', workspace: 'workspace/' });
});

// 本地 xterm（避免 CDN 依賴）：/vendor/xterm/xterm.mjs, /vendor/fit/addon-fit.mjs, /vendor/xterm-css/xterm.css
app.use('/vendor/xterm', express.static(path.join(__dirname, 'node_modules/@xterm/xterm/lib')));
app.use('/vendor/xterm-css', express.static(path.join(__dirname, 'node_modules/@xterm/xterm/css')));
app.use('/vendor/fit', express.static(path.join(__dirname, 'node_modules/@xterm/addon-fit/lib')));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/shell' });

// ---- 單一全域 pty（v0.1 先不做多 session） ----
const SHELL = process.env.SHELL || 'bash';
let term = null;

function spawnPty(cols = 80, rows = 24) {
  term = pty.spawn(SHELL, ['-i'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: WORKSPACE,
    env: { ...process.env, TERM: 'xterm-256color' },
  });
  term.onData((data) => {
    broadcast(JSON.stringify({ type: 'output', data }));
  });
  term.onExit(({ exitCode }) => {
    broadcast(JSON.stringify({ type: 'output', data: `\r\n[shell exited ${exitCode}, respawning…]\r\n` }));
    // 給前端一點時間看到訊息再重建
    setTimeout(() => spawnPty(cols, rows), 500);
  });
}

function broadcast(msg) {
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

spawnPty();

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', cwd: 'workspace/', shell: SHELL }));
  ws.send(JSON.stringify({ type: 'output', data: '\r\n[shellbook v0.1 connected — type commands below]\r\n' }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!term) return;
    switch (msg.type) {
      case 'input':
        if (typeof msg.data === 'string') term.write(msg.data);
        break;
      case 'resize':
        if (Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
          try {
            term.resize(Math.min(msg.cols, 300), Math.min(msg.rows, 100));
          } catch { /* ignore */ }
        }
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  });
});

server.listen(PORT, () => {
  console.log(`shellbook v0.1 listening on http://localhost:${PORT}`);
});
