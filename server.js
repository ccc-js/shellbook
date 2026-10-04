// shellbook v0.5 — 多 session 沙盒＋安全防線
// - 每條 WS 一個 session：獨立 pty＋Runner，cwd=workspace/sessions/<id>/（$SHELLBOOK_WS 指向它）
// - ?session=<id> 可 reattach；上限 maxSessions；閒置 idleMs 回收；audit 記到 logs/<id>.log
// - run/step 全塊預檢 deny-list；手打逐行守衛（直接打字精準，方向鍵編輯過的行放行並註記）
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');
const books = require('./src/books');
const { Runner } = require('./src/runner');
const guard = require('./src/guard');
const { splitSteps } = require('./src/steps');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const WORKSPACE = path.join(ROOT, 'workspace');
const SESSIONS_DIR = path.join(WORKSPACE, 'sessions');
const LOGS_DIR = path.join(ROOT, 'logs');
const SHELL = process.env.SHELL || 'bash';

// ---- config（預設＋config/shellbook.json＋env 覆寫） ----
function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'shellbook.json'), 'utf8'));
  } catch { /* 用預設 */ }
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    maxSessions: num(process.env.SHELLBOOK_MAX_SESSIONS ?? file.maxSessions, 8),
    idleMs: num(process.env.SHELLBOOK_IDLE_MS ?? file.idleMs, 30 * 60 * 1000),
    sweepMs: num(process.env.SHELLBOOK_SWEEP_MS ?? file.sweepMs, 60 * 1000),
    timeoutMs: num(process.env.SHELLBOOK_TIMEOUT_MS ?? file.timeoutMs, 30 * 1000),
    maxOutputBytes: num(process.env.SHELLBOOK_MAX_OUTPUT ?? file.maxOutputBytes, 64 * 1024),
    warn: Array.isArray(file.warn) && file.warn.length ? file.warn : guard.WARN_SUBSTRINGS,
  };
}
const config = loadConfig();

// 沙盒根目錄常駐；session 目錄以 uuid 命名不會碰撞。
// 被 kill 的 server 殘留目錄是惰性的（沒有 pty 活著），由 DELETE／閒置回收或手動清理。
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: 'v0.5', workspace: 'workspace/', sessions: sessions.size });
});

app.get('/api/config', (req, res) => {
  res.json({ maxSessions: config.maxSessions, timeoutMs: config.timeoutMs, maxOutputBytes: config.maxOutputBytes, warn: config.warn });
});

// ---- Book API（沿用 v0.2） ----
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

// ---- Session API ----
app.get('/api/sessions', (req, res) => {
  res.json(
    [...sessions.values()].map((s) => ({ id: s.id, createdAt: s.createdAt, lastActive: s.lastActive, clients: s.clients.size }))
  );
});
app.delete('/api/sessions/:id', (req, res) => {
  if (!sessions.has(req.params.id)) return res.status(404).json({ error: 'session not found' });
  destroySession(req.params.id, 'deleted');
  res.json({ ok: true });
});

app.use('/vendor/xterm', express.static(path.join(__dirname, 'node_modules/@xterm/xterm/lib')));
app.use('/vendor/xterm-css', express.static(path.join(__dirname, 'node_modules/@xterm/xterm/css')));
app.use('/vendor/fit', express.static(path.join(__dirname, 'node_modules/@xterm/addon-fit/lib')));
app.use('/vendor/marked', express.static(path.join(__dirname, 'node_modules/marked/lib')));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/shell' });

// ================= sessions =================
const sessions = new Map();

function audit(sess, entry) {
  try {
    let e = entry;
    if (e.code && e.code.length > 2000) e = { ...e, code: e.code.slice(0, 2000) + '…[truncated]' };
    if (e.line && e.line.length > 500) e = { ...e, line: e.line.slice(0, 500) + '…' };
    fs.appendFileSync(path.join(LOGS_DIR, `${sess.id}.log`), JSON.stringify({ t: new Date().toISOString(), session: sess.id, ...e }) + '\n');
  } catch { /* audit 不該搞死主流程 */ }
}

function spawnSessionPty(sess, cols = 80, rows = 24) {
  sess.pty = pty.spawn(SHELL, ['-i'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: sess.dir,
    env: { ...process.env, TERM: 'xterm-256color', SHELLBOOK_WS: sess.dir, SHELLBOOK_SESSION: sess.id },
  });
  sess.pty.onData((data) => {
    touch(sess);
    sess.runner.sniff(data);
    const msg = JSON.stringify({ type: 'output', data });
    for (const ws of sess.clients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  });
  sess.pty.onExit(({ exitCode }) => {
    for (const ws of sess.clients) {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data: `\r\n[shell exited ${exitCode}, respawning…]\r\n` }));
    }
    setTimeout(() => {
      if (sessions.get(sess.id) === sess) spawnSessionPty(sess, cols, rows);
    }, 500);
  });
}

function createSession() {
  const id = randomUUID();
  const dir = path.join(SESSIONS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const sess = {
    id, dir, pty: null, runner: null,
    clients: new Set(), manual: new Map(),
    createdAt: Date.now(), lastActive: Date.now(),
  };
  sess.runner = new Runner({
    write: (d) => {
      if (sessions.get(id) === sess && sess.pty) sess.pty.write(d);
    },
    timeoutMs: config.timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    onEvent: (e) => {
      if (e.type === 'result' || e.type === 'stepResult') {
        audit(sess, { kind: e.type, blockId: e.blockId, index: e.index, line: e.line, exitCode: e.exitCode, timeout: !!e.timeout, durationMs: e.durationMs });
      }
    },
  });
  sessions.set(id, sess);
  spawnSessionPty(sess);
  audit(sess, { kind: 'session-create', dir: path.relative(ROOT, dir) });
  return sess;
}

function touch(sess) {
  sess.lastActive = Date.now();
}

function destroySession(id, reason = 'closed') {
  const sess = sessions.get(id);
  if (!sess) return;
  sessions.delete(id);
  audit(sess, { kind: 'session-destroy', reason });
  for (const ws of sess.clients) {
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'session-ended', reason }));
      ws.close(1000, reason);
    } catch { /* ignore */ }
    sess.runner.dropWs(ws);
  }
  sess.clients.clear();
  try {
    if (sess.pty) sess.pty.kill();
  } catch { /* ignore */ }
  fs.rmSync(sess.dir, { recursive: true, force: true });
}

setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of sessions) {
    if (now - sess.lastActive > config.idleMs) destroySession(id, 'idle');
  }
}, config.sweepMs).unref();

// ---- run/step 前 deny-list 預檢（整塊原子：有一行擋就整塊不跑） ----
function precheck(ws, sess, kind, blockId, code) {
  const lines = splitSteps(String(code || ''));
  for (let i = 0; i < lines.length; i++) {
    const g = guard.isDenied(lines[i]);
    if (g.denied) {
      const doneType = kind === 'run' ? 'runDone' : 'stepResult';
      ws.send(JSON.stringify({ type: 'blocked', blockId, index: i, reason: g.reason, line: lines[i] }));
      ws.send(JSON.stringify({ type: doneType, blockId, ok: false, error: 'blocked', blockedIndex: i, reason: g.reason }));
      audit(sess, { kind: 'blocked', via: kind, blockId, index: i, reason: g.reason, line: lines[i] });
      return null;
    }
  }
  return lines;
}

// ---- 手打守衛 ----
// 直接打字：逐字轉發（即時回顯），Enter 時判整行；危險則送 Ctrl-U 吃掉 shell 行緩衝。
// 行編輯（方向鍵/tab 補齊）會讓追蹤失準：判行前先去掉 ESC 序列再判（近似，比不判好）。
// 已知限制：bracketed-paste 包裝先解開內文再判；刻意用補齊拼出危險指令屬於文件記載的限制，
// 書驅動路徑（run/step）才是嚴格防線。
function visibleLine(buf) {
  return buf
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '');
}
function handleInput(ws, sess, data) {
  touch(sess);
  let st = sess.manual.get(ws);
  if (!st) {
    st = { buf: '', dirty: false };
    sess.manual.set(ws, st);
  }
  // bracketed paste（xterm.js/新版 shell 會包）：解開，內文照一般字元判
  data = data.replace(/\x1b\[200~([\s\S]*?)\x1b\[201~/g, '$1');
  for (const ch of data) {
    if (ch === '\r' || ch === '\n') {
      const line = visibleLine(st.buf);
      const g = guard.isDenied(line);
      audit(sess, { kind: 'input-line', line, dirty: st.dirty, blocked: g.denied });
      if (g.denied) {
        sess.pty.write('\x15'); // Ctrl-U：吃掉 shell 行緩衝裡的前綴，不執行
        ws.send(JSON.stringify({ type: 'output', data: `\r\n⛔ 已阻擋危險指令（${g.reason}），該行未執行\r\n` }));
      } else {
        sess.pty.write(ch);
      }
      st.buf = '';
      st.dirty = false;
    } else if (ch === '\x7f') {
      // DEL：shell 刪一個字，我們的追蹤跟著刪
      st.buf = st.buf.slice(0, -1);
      sess.pty.write(ch);
    } else if (ch === '\x03' || ch === '\x15') {
      // Ctrl-C / Ctrl-U：shell 清行，追蹤跟著清
      st.buf = '';
      st.dirty = false;
      sess.pty.write(ch);
    } else {
      if (ch === '\x1b') st.dirty = true;
      st.buf += ch;
      sess.pty.write(ch);
    }
  }
}

wss.on('connection', (ws, req) => {
  let sess = null;
  try {
    const want = new URL(req.url, 'http://x').searchParams.get('session');
    if (want && sessions.has(want)) sess = sessions.get(want);
  } catch { /* ignore */ }
  if (!sess) {
    if (sessions.size >= config.maxSessions) {
      ws.send(JSON.stringify({ type: 'error', error: 'max-sessions', max: config.maxSessions }));
      ws.close(1013, 'max sessions');
      return;
    }
    sess = createSession();
  }
  sess.clients.add(ws);
  sess.manual.set(ws, { buf: '', dirty: false });
  touch(sess);
  ((s) => {
    ws.send(JSON.stringify({ type: 'session', id: s.id, cwd: `workspace/sessions/${s.id}/` }));
    ws.send(JSON.stringify({ type: 'output', data: '\r\n[shellbook v0.5 connected — session sandbox]\r\n' }));

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      touch(s);
      switch (msg.type) {
        case 'input':
          if (typeof msg.data === 'string') handleInput(ws, s, msg.data);
          break;
        case 'resize':
          if (Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
            try {
              s.pty.resize(Math.min(msg.cols, 300), Math.min(msg.rows, 100));
            } catch { /* ignore */ }
          }
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        case 'run':
          if (typeof msg.code === 'string') {
            const lines = precheck(ws, s, 'run', msg.blockId, msg.code);
            if (lines && lines.length) {
              audit(s, { kind: 'run', blockId: msg.blockId, lines: lines.length });
              s.runner.handleRun(ws, { blockId: msg.blockId, code: msg.code });
            } else if (lines) {
              s.runner.handleRun(ws, { blockId: msg.blockId, code: msg.code }); // 空：讓 runner 回 empty
            }
          }
          break;
        case 'step':
          if (typeof msg.code === 'string') {
            const lines = precheck(ws, s, 'step', msg.blockId, msg.code);
            if (lines && lines.length) {
              audit(s, { kind: 'step', blockId: msg.blockId, lines: lines.length });
              s.runner.handleStep(ws, { blockId: msg.blockId, code: msg.code });
            } else if (lines) {
              s.runner.handleStep(ws, { blockId: msg.blockId, code: msg.code });
            }
          }
          break;
        case 'reset':
          s.runner.handleReset(ws, { blockId: msg.blockId });
          break;
      }
    });

    ws.on('close', () => {
      s.clients.delete(ws);
      s.manual.delete(ws);
      s.runner.dropWs(ws);
      touch(s);
    });
  })(sess);
});

server.listen(PORT, () => {
  console.log(`shellbook v0.5 listening on http://localhost:${PORT} (maxSessions=${config.maxSessions})`);
});
