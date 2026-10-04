// shellbook v0.6 e2e：進度追蹤＋expect 對照＋筆記匯出＋前端靜態斷言
// 跑法：npm test（node --test test/*.test.js）
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = process.env.TEST_PORT || '3143';
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');

// progress 寫進 tmp，不污染 repo
const TMP_PROG = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-prog-'));
process.env.SHELLBOOK_PROGRESS_DIR = TMP_PROG;

let serverProc = null;
const exportedFiles = [];

async function waitFor(fn, { timeout = 60000, interval = 50, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

function connect(sessionId) {
  const q = sessionId ? `?session=${encodeURIComponent(sessionId)}` : '';
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/shell${q}`);
  const inbox = [];
  let sid = null;
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'output') {
        inbox.push(msg);
        if (msg.type === 'session') sid = msg.id;
      }
    } catch { /* ignore */ }
  });
  const waitOpen = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return {
    ws,
    waitOpen,
    get sessionId() {
      return sid;
    },
    send(o) {
      ws.send(JSON.stringify(o));
    },
    async next(pred, { timeout = 60000 } = {}) {
      return waitFor(
        () => {
          const i = inbox.findIndex(pred);
          return i >= 0 ? inbox.splice(i, 1)[0] : false;
        },
        { timeout, label: 'ws message' }
      );
    },
    drain() {
      return inbox.splice(0);
    },
    close() {
      return new Promise((resolve) => {
        if (ws.readyState >= 2) return resolve();
        ws.on('close', resolve);
        ws.close();
        setTimeout(resolve, 1000);
      });
    },
  };
}

before(async () => {
  serverProc = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SHELLBOOK_MAX_SESSIONS: '64' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitFor(
    async () => {
      try {
        const r = await fetch(`${BASE}/api/health`);
        return r.ok;
      } catch {
        return false;
      }
    },
    { timeout: 20000, label: 'server /api/health' }
  );
});

after(async () => {
  try {
    const list = await (await fetch(`${BASE}/api/sessions`)).json();
    for (const s of list) {
      try {
        await fetch(`${BASE}/api/sessions/${s.id}`, { method: 'DELETE' });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  if (serverProc) {
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!serverProc.killed) serverProc.kill('SIGKILL');
  }
  for (const f of exportedFiles) {
    try {
      fs.unlinkSync(path.join(ROOT, 'notes', f));
    } catch { /* ignore */ }
  }
  fs.rmSync(TMP_PROG, { recursive: true, force: true });
});

// ---------- progress 單元（直接 require，走 TMP 目錄） ----------
test('progress 單元：記/查/按章重置/整本重置', async () => {
  const progress = require('../src/progress');
  assert.deepEqual(progress.getBook('demo6').blocks, {});
  progress.record('demo6', 'ch01-a-1', { status: 'done', exitCode: 0, expectMet: true });
  progress.record('demo6', 'ch02-b-1', { status: 'failed', exitCode: 1, expectMet: false });
  let d = progress.getBook('demo6');
  assert.equal(d.blocks['ch01-a-1'].status, 'done');
  assert.equal(d.blocks['ch01-a-1'].runs, 1);
  progress.record('demo6', 'ch01-a-1', { status: 'done', exitCode: 0 });
  assert.equal(progress.getBook('demo6').blocks['ch01-a-1'].runs, 2);
  progress.reset('demo6', 'ch01-a');
  d = progress.getBook('demo6');
  assert.ok(!d.blocks['ch01-a-1'] && d.blocks['ch02-b-1'], 'chapter reset wrong');
  progress.reset('demo6');
  assert.deepEqual(progress.getBook('demo6').blocks, {});
});

// ---------- e2e：進度生命週期 ----------
test('e2e：跑完記 done，重跑累次；失敗記 failed；可按章/整本重置', async () => {
  const c = connect();
  await c.waitOpen;
  await waitFor(() => c.sessionId, { label: 'session' });
  const BID = 'ch02-files-2'; // demo 真實 block（expect:apple，輸出沒有 → met:false）
  c.send({ type: 'run', blockId: BID, code: 'echo LIFECYCLE', book: 'demo', ch: 'ch02-files' });
  await c.next((m) => m.type === 'runDone' && m.blockId === BID && m.ok === true);
  let p = await (await fetch(`${BASE}/api/progress/demo`)).json();
  assert.equal(p.blocks[BID].status, 'done');
  assert.equal(p.blocks[BID].runs, 1);
  assert.equal(p.blocks[BID].expectMet, false);

  c.send({ type: 'run', blockId: BID, code: 'false', book: 'demo', ch: 'ch02-files' });
  await c.next((m) => m.type === 'runDone' && m.blockId === BID && m.ok === false);
  p = await (await fetch(`${BASE}/api/progress/demo`)).json();
  assert.equal(p.blocks[BID].status, 'failed');
  assert.equal(p.blocks[BID].runs, 2);

  await fetch(`${BASE}/api/progress/demo?chapter=ch02-files`, { method: 'DELETE' });
  p = await (await fetch(`${BASE}/api/progress/demo`)).json();
  assert.ok(!p.blocks[BID], 'chapter reset failed');

  c.send({ type: 'run', blockId: BID, code: 'echo AGAIN', book: 'demo', ch: 'ch02-files' });
  await c.next((m) => m.type === 'runDone' && m.blockId === BID && m.ok === true);
  await fetch(`${BASE}/api/progress/demo`, { method: 'DELETE' });
  p = await (await fetch(`${BASE}/api/progress/demo`)).json();
  assert.deepEqual(p.blocks, {});
  await c.close();
});

// ---------- e2e：expect 對照 ----------
test('e2e：expect 命中回 met:true', async () => {
  const c = connect();
  await c.waitOpen;
  await waitFor(() => c.sessionId, { label: 'session' });
  // ch01-hello-1 的 expect 是 hello
  c.send({ type: 'run', blockId: 'ch01-hello-1', code: 'echo hello', book: 'demo', ch: 'ch01-hello' });
  await c.next((m) => m.type === 'runDone' && m.blockId === 'ch01-hello-1' && m.ok === true);
  const exp = await c.next((m) => m.type === 'expect' && m.blockId === 'ch01-hello-1');
  assert.equal(exp.keyword, 'hello');
  assert.equal(exp.met, true);
  const p = await (await fetch(`${BASE}/api/progress/demo`)).json();
  assert.equal(p.blocks['ch01-hello-1'].expectMet, true);
  await c.close();
});

test('e2e：expect 沒出現回 met:false', async () => {
  const c = connect();
  await c.waitOpen;
  await waitFor(() => c.sessionId, { label: 'session' });
  c.send({ type: 'run', blockId: 'ch01-hello-1', code: 'echo nothing-here', book: 'demo', ch: 'ch01-hello' });
  await c.next((m) => m.type === 'runDone' && m.blockId === 'ch01-hello-1' && m.ok === true);
  const exp = await c.next((m) => m.type === 'expect' && m.blockId === 'ch01-hello-1');
  assert.equal(exp.met, false);
  await c.close();
});

test('e2e：沒有 expect 的 block 不發 expect 訊息', async () => {
  const c = connect();
  await c.waitOpen;
  await waitFor(() => c.sessionId, { label: 'session' });
  // ch01-hello-2 沒有 expect
  c.send({ type: 'run', blockId: 'ch01-hello-2', code: 'echo noexpect', book: 'demo', ch: 'ch01-hello' });
  await c.next((m) => m.type === 'runDone' && m.blockId === 'ch01-hello-2');
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(!c.drain().some((m) => m.type === 'expect'), 'unexpected expect message');
  await c.close();
});

test('e2e：單步走完也記進度＋對 expect', async () => {
  const c = connect();
  await c.waitOpen;
  await waitFor(() => c.sessionId, { label: 'session' });
  c.send({ type: 'step', blockId: 'ch01-hello-1', code: 'echo hello', book: 'demo', ch: 'ch01-hello' });
  const r = await c.next((m) => m.type === 'stepResult' && m.blockId === 'ch01-hello-1');
  assert.equal(r.done, true);
  const exp = await c.next((m) => m.type === 'expect' && m.blockId === 'ch01-hello-1');
  assert.equal(exp.met, true);
  await c.close();
});

// ---------- e2e：筆記匯出 ----------
test('e2e：匯出筆記含指令與輸出；列表看得到；壞參數擋掉', async () => {
  const c = connect();
  await c.waitOpen;
  await waitFor(() => c.sessionId, { label: 'session' });
  const sid = c.sessionId;
  c.send({ type: 'run', blockId: 'ch01-hello-1', code: 'echo NOTE_PROBE_99', book: 'demo', ch: 'ch01-hello' });
  await c.next((m) => m.type === 'runDone' && m.blockId === 'ch01-hello-1');
  await c.close();

  const bad = await fetch(`${BASE}/api/notes/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: 'xx' }),
  });
  assert.equal(bad.status, 400);
  const missing = await fetch(`${BASE}/api/notes/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: '00000000-0000-0000-0000-000000000000' }),
  });
  assert.equal(missing.status, 404);

  const r = await fetch(`${BASE}/api/notes/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sid }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.file.endsWith('.md'));
  assert.ok(j.markdown.includes('ch01-hello-1'), 'missing blockId');
  assert.ok(j.markdown.includes('NOTE_PROBE_99'), 'missing output');
  assert.ok(j.markdown.includes('demo/ch01-hello'), 'missing book context');
  exportedFiles.push(j.file);
  const list = await (await fetch(`${BASE}/api/notes`)).json();
  assert.ok(list.some((n) => n.file === j.file), 'not listed');
});

// ---------- 前端靜態斷言（無瀏覽器時守住 v0.6 UI 鉤子） ----------
test('前端靜態：v0.6 UI 鉤子都在', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  for (const needle of [
    '匯出筆記', 'attachCustomKeyEventHandler', 'data-book-act', '重跑本章',
    'cb-exp', 'chBar', 'chFill', 'paintProgress', '/api/progress/', '/api/notes/export',
    'codeHtml', 'hintFor',
  ]) {
    assert.ok(html.includes(needle), `index.html missing: ${needle}`);
  }
});
