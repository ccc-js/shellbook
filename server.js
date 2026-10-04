// shellbook v0.3 — Shell 通道 + Book 載入 + 點書即跑（單步/全跑）
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');
const books = require('./src/books');
const { Runner } = require('./src/runner');

const PORT = process.env.PORT || 3000;
const WORKSPACE = path.join(__dirname, 'workspace');
fs.mkdirSync(WORKSPACE, { recursive: true });

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: 'v0.3', workspace: 'workspace/' });
});

// ---- Book API（v0.2 唯讀） ----
function sendBookError(res, e) {
  res.status(e.status || 500).json({ error: e.message || 'internal error' });
}
app.get('/api/books', (req, res) => {
  res.json(books.listBooks());
});
app.get('/api/books/:name', (req, res) => {
  try {
    res.json(books.getBook(req.params.name));
  } catch (e) {
    sendBookError(res, e);
  }
});
app.get('/api/books/:name/ch/:ch', (req, res) => {
  try {
    res.json(books.getChapter(req.params.name, req.params.ch));
  } catch (e) {
    sendBookError(res, e);
  }
});

// 本地 xterm（避免 CDN 依賴）：/vendor/xterm/xterm.mjs, /vendor/fit/addon-fit.mjs, /vendor/xterm-css/xterm.css
app.use('/vendor/xterm', express.static(path.join(__dirname, 'node_modules/@xterm/xterm/lib')));
app.use('/vendor/xterm-css', express.static(path.join(__dirname, 'node_modules/@xterm/xterm/css')));
app.use('/vendor/fit', express.static(path.join(__dirname, 'node_modules/@xterm/addon-fit/lib')));
app.use('/vendor/marked', express.static(path.join(__dirname, 'node_modules/marked/lib')));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/shell' });

// ---- 單一全域 pty（v0.3：共用；執行由 Runner 排隊，避免交錯） ----
const SHELL = process.env.SHELL || 'bash';
let term = null;
const runner = new Runner({ write: (d) => term && term.write(d) });

function spawnPty(cols = 80, rows = 24) {
  term = pty.spawn(SHELL, ['-i'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: WORKSPACE,
    env: { ...process.env, TERM: 'xterm-256color' },
  });
  term.onData((data) => {
    runner.sniff(data);
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
  ws.send(JSON.stringify({ type: 'output', data: '\r\n[shellbook v0.3 connected — type commands below]\r\n' }));

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
      case 'run': // 全跑：{ blockId, code }
        if (typeof msg.code === 'string') runner.handleRun(ws, { blockId: msg.blockId, code: msg.code });
        break;
      case 'step': // 單步：{ blockId, code }，調一次跑一行
        if (typeof msg.code === 'string') runner.handleStep(ws, { blockId: msg.blockId, code: msg.code });
        break;
      case 'reset': // 清除單步游標：{ blockId? }
        runner.handleReset(ws, { blockId: msg.blockId });
        break;
    }
  });

  ws.on('close', () => runner.dropWs(ws));
});

server.listen(PORT, () => {
  console.log(`shellbook v0.3 listening on http://localhost:${PORT}`);
});
