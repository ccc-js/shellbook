// shellbook v0.8 — 多 session 沙盒＋安全防線（預設只綁 localhost）
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
const progress = require('./src/progress');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const WORKSPACE = path.join(ROOT, 'workspace');
const SESSIONS_DIR = path.join(WORKSPACE, 'sessions');
const LOGS_DIR = path.join(ROOT, 'logs');
const NOTES_DIR = path.join(ROOT, 'notes');
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
    host: process.env.SHELLBOOK_HOST ?? file.host ?? '127.0.0.1', // v0.8：預設只綁本機
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
fs.mkdirSync(NOTES_DIR, { recursive: true });

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: 'v1.0', workspace: 'workspace/', sessions: sessions.size });
});

app.get('/api/config', (req, res) => {
  res.json({ maxSessions: config.maxSessions, timeoutMs: config.timeoutMs, maxOutputBytes: config.maxOutputBytes, warn: config.warn, host: config.host });
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

// ---- Progress API（v0.6：跨 tab 的學習進度） ----
app.get('/api/progress/:book', (req, res) => {
  try {
    res.json(progress.getBook(req.params.book));
  } catch (e) {
    sendBookError(res, e);
  }
});
app.delete('/api/progress/:book', (req, res) => {
  try {
    res.json(progress.reset(req.params.book, req.query.chapter));
  } catch (e) {
    sendBookError(res, e);
  }
});

// ---- Notes API（v0.6：把 session 的 audit 匯出成學習筆記） ----
app.get('/api/notes', (req, res) => {
  try {
    const files = fs.existsSync(NOTES_DIR)
      ? fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith('.md')).sort().reverse()
      : [];
    res.json(files.map((f) => {
      const st = fs.statSync(path.join(NOTES_DIR, f));
      return { file: f, size: st.size, mtime: st.mtime };
    }));
  } catch (e) {
    sendBookError(res, e);
  }
});
app.post('/api/notes/export', (req, res) => {
  try {
    const session = String((req.body && req.body.session) || '');
    if (!/^[A-Za-z0-9-]{8,}$/.test(session)) return res.status(400).json({ error: 'bad session' });
    const logf = path.join(LOGS_DIR, `${session}.log`);
    if (!fs.existsSync(logf)) return res.status(404).json({ error: 'no log for session' });
    const entries = fs.readFileSync(logf, 'utf8').split('\n').filter(Boolean).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
    const markdown = buildNotes(session, entries);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const file = `notes-${stamp}-${session.slice(0, 8)}.md`;
    fs.writeFileSync(path.join(NOTES_DIR, file), markdown);
    res.json({ ok: true, file, markdown });
  } catch (e) {
    sendBookError(res, e);
  }
});

function buildNotes(session, entries) {
  const out = ['# shellbook 學習筆記', '', `- session: ${session}`, `- 匯出：${new Date().toISOString()}`, ''];
  const order = [];
  const groups = new Map(); // blockId -> { book, ch, steps: Map(index -> {line, exitCode, durationMs, output}) }
  const blocked = [];
  for (const e of entries) {
    if (e.kind === 'run' || e.kind === 'step') {
      if (!groups.has(e.blockId)) {
        groups.set(e.blockId, { book: e.book || null, ch: e.ch || null, steps: new Map() });
        order.push(e.blockId);
      }
    } else if (e.kind === 'result' || e.kind === 'stepResult') {
      if (!groups.has(e.blockId)) {
        groups.set(e.blockId, { book: null, ch: null, steps: new Map() });
        order.push(e.blockId);
      }
      groups.get(e.blockId).steps.set(e.index, {
        line: e.line, exitCode: e.exitCode, durationMs: e.durationMs, output: e.output || '',
      });
    } else if (e.kind === 'blocked') {
      blocked.push(e);
    }
  }
  for (const id of order) {
    const g = groups.get(id);
    out.push(`## ${id}${g.book ? `（${g.book}${g.ch ? `/${g.ch}` : ''}）` : ''}`, '');
    const idxs = [...g.steps.keys()].sort((a, b) => a - b);
    if (!idxs.length) {
      out.push('（已送出，尚無執行結果）', '');
      continue;
    }
    for (const i of idxs) {
      const s = g.steps.get(i);
      out.push(`### 第 ${i + 1} 步（exit=${s.exitCode}${s.durationMs != null ? `，${s.durationMs}ms` : ''}）`, '', '```sh', s.line || '', '```', '');
      if (s.output && s.output.trim()) out.push('輸出：', '', '```', s.output.trim().slice(-3000), '```', '');
    }
  }
  if (blocked.length) {
    out.push('## 被阻擋的指令', '');
    for (const b of blocked) out.push(`- ${b.blockId || ''} 第 ${(b.index ?? 0) + 1} 行（${b.reason || ''}）：\`${b.line || ''}\``, '');
  }
  return out.join('\n');
}

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
    if (e.output && e.output.length > 2048) e = { ...e, output: e.output.slice(-2048) + '\n…[output truncated]' };
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
    runs: new Map(), ctxq: new Map(), // runs: ws -> Map(blockId -> {book,ch,outputs}); ctxq: ws -> [{kind,blockId,book,ch}]
    createdAt: Date.now(), lastActive: Date.now(),
  };
  sess.runner = new Runner({
    write: (d) => {
      if (sessions.get(id) === sess && sess.pty) sess.pty.write(d);
    },
    timeoutMs: config.timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    onEvent: (e, ws) => {
      if (e.type === 'result' || e.type === 'stepResult') {
        audit(sess, { kind: e.type, blockId: e.blockId, index: e.index, line: e.line, exitCode: e.exitCode, timeout: !!e.timeout, durationMs: e.durationMs, output: e.output });
        const acc = sess.runs.get(ws)?.get(e.blockId);
        if (acc && typeof e.output === 'string') acc.outputs.push(e.output);
        if (acc && e.exitCode !== undefined) acc.lastExit = e.exitCode;
      }
      if (e.type === 'runStarted' || e.type === 'stepStarted') {
        // FIFO：request 時排的 ctx 在 started 時兌現
        const q = sess.ctxq.get(ws);
        const ctx = q && q.length ? q.shift() : null;
        if (ctx && ctx.book) {
          let m = sess.runs.get(ws);
          if (!m) {
            m = new Map();
            sess.runs.set(ws, m);
          }
          m.set(e.blockId, { book: ctx.book, ch: ctx.ch || null, outputs: [] });
        }
      }
      if (e.type === 'runDone' || (e.type === 'stepResult' && e.done)) {
        finishTrackedRun(sess, ws, e);
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

// v0.6：run/step 帶 book+ch 時，結束後記進度＋對 expect 關鍵字
function lookupExpect(book, ch, blockId) {
  try {
    if (!book || !ch) return null;
    const d = books.getChapter(book, ch);
    const b = d.blocks.find((x) => x.id === blockId);
    return b && b.expect ? b.expect : null;
  } catch {
    return null;
  }
}

function pushRunCtx(sess, ws, kind, blockId, book, ch) {
  if (!book) return;
  let q = sess.ctxq.get(ws);
  if (!q) {
    q = [];
    sess.ctxq.set(ws, q);
  }
  q.push({ kind, blockId, book, ch: ch || null });
}

function finishTrackedRun(sess, ws, e) {
  const m = sess.runs.get(ws);
  const acc = m && m.get(e.blockId);
  if (m) m.delete(e.blockId);
  else {
    // 沒有 acc：可能是沒帶 book 的 run，或 empty run 的孤兒 ctx，清一個
    const q = sess.ctxq.get(ws);
    if (q && q.length) q.shift();
  }
  if (!acc) return;
  const failed = e.ok === false || !!e.error || (e.exitCode !== null && e.exitCode !== undefined && e.exitCode !== 0);
  const keyword = lookupExpect(acc.book, acc.ch, e.blockId);
  const met = keyword ? acc.outputs.join('\n').includes(keyword) : null;
  progress.record(acc.book, e.blockId, { status: failed ? 'failed' : 'done', exitCode: e.exitCode ?? acc.lastExit ?? null, expectMet: met });
  if (keyword && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'expect', blockId: e.blockId, keyword, met }));
  }
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
    ws.send(JSON.stringify({ type: 'output', data: '\r\n[shellbook v1.0 connected — session sandbox]\r\n' }));

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
              pushRunCtx(s, ws, 'run', msg.blockId, msg.book, msg.ch);
              audit(s, { kind: 'run', blockId: msg.blockId, book: msg.book || null, ch: msg.ch || null, lines: lines.length });
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
              pushRunCtx(s, ws, 'step', msg.blockId, msg.book, msg.ch);
              audit(s, { kind: 'step', blockId: msg.blockId, book: msg.book || null, ch: msg.ch || null, lines: lines.length });
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
      s.runs.delete(ws);
      s.ctxq.delete(ws);
      s.runner.dropWs(ws);
      touch(s);
    });
  })(sess);
});

server.listen(Number(PORT), config.host, () => {
  console.log(`shellbook v1.0 listening on http://${config.host}:${PORT} (maxSessions=${config.maxSessions})`);
});
