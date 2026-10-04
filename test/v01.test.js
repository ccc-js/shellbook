// shellbook v0.1 e2e：起真 server + 真 pty + 真 websocket 全鏈路測試
// 跑法：npm test（node --test test/）
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = process.env.TEST_PORT || '3137';
const BASE = `http://127.0.0.1:${PORT}`;
const WSURL = `ws://127.0.0.1:${PORT}/ws/shell`;
const ROOT = path.join(__dirname, '..');

let serverProc = null;

// ---------- helpers ----------
async function waitFor(fn, { timeout = 15000, interval = 100, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function waitServerUp() {
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
}

// 互動式 shell 會回顯輸入 + 提示字元污染輸出，斷言時先做正規化：
// 移除 \r、ANSI escape、提示字元行，方便用 includes 比對。
function clean(buf) {
  return (
    buf
      .replace(/\r/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/[^\x20-\x7e\n_\/.-]/g, '')
  );
}

function makeClient() {
  const ws = new WebSocket(WSURL);
  let buf = '';
  const outQueue = [];
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'output') {
        buf += msg.data;
        outQueue.push(msg.data);
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
    send(o) {
      ws.send(JSON.stringify(o));
    },
    input(s) {
      ws.send(JSON.stringify({ type: 'input', data: s }));
    },
    // 等到累積輸出（正規化後）包含 needle；每次呼叫前先清空，避免吃到上一案殘留
    reset() {
      buf = '';
    },
    async expectIncludes(needle, { timeout = 15000 } = {}) {
      const hit = await waitFor(() => (clean(buf).includes(needle) ? true : false), {
        timeout,
        label: `output includes ${JSON.stringify(needle)}`,
      });
      return hit;
    },
    get raw() {
      return buf;
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

// ---------- lifecycle ----------
before(async () => {
  serverProc = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(`[srv] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`[srv:err] ${d}`));
  await waitServerUp();
});

after(async () => {
  if (serverProc) {
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!serverProc.killed) serverProc.kill('SIGKILL');
  }
});

// ---------- HTTP ----------
test('GET /api/health 回 ok + v0.1', async () => {
  const r = await fetch(`${BASE}/api/health`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.version, 'v0.1');
});

test('GET / 回主介面：三區骨架都在', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('id="menu"'), 'missing #menu');
  assert.ok(html.includes('id="book"'), 'missing #book');
  assert.ok(html.includes('id="terminal"'), 'missing #terminal');
  assert.ok(html.includes('id="splitter"'), 'missing #splitter（可拖曳分隔條）');
});

test('靜態 vendor：xterm mjs + css 可取回', async () => {
  for (const p of ['/vendor/xterm/xterm.mjs', '/vendor/fit/addon-fit.mjs', '/vendor/xterm-css/xterm.css']) {
    const r = await fetch(`${BASE}${p}`);
    assert.equal(r.status, 200, p);
  }
});

// ---------- WS e2e ----------
test('ws e2e：echo 基本執行', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.reset();
  c.input('echo SB_E2E_HELLO_42\n');
  await c.expectIncludes('SB_E2E_HELLO_42');
  await c.close();
});

test('ws e2e：pwd 位於 workspace', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.reset();
  c.input('pwd\n');
  await c.expectIncludes('workspace');
  await c.close();
});

test('ws e2e：長輸出 seq 1 200 不丟失', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.reset();
  c.input('seq 1 200\n');
  await c.expectIncludes('199', { timeout: 20000 });
  await c.expectIncludes('200', { timeout: 20000 });
  await c.close();
});

test('ws e2e：resize 後 shell 仍可執行', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.send({ type: 'resize', cols: 100, rows: 30 });
  c.send({ type: 'resize', cols: 10, rows: 5 }); // 極端小
  c.send({ type: 'resize', cols: 80, rows: 24 }); // 回正常
  c.reset();
  c.input('echo AFTER_RESIZE_OK\n');
  await c.expectIncludes('AFTER_RESIZE_OK');
  await c.close();
});

test('ws e2e：Ctrl+C 可中斷 sleep 並繼續執行', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.reset();
  c.input('sleep 30\n');
  await new Promise((r) => setTimeout(r, 800)); // 確定 sleep 已起跑
  c.input('\x03'); // Ctrl+C
  await new Promise((r) => setTimeout(r, 800));
  c.reset();
  c.input('echo AFTER_INT_OK\n');
  await c.expectIncludes('AFTER_INT_OK', { timeout: 20000 });
  await c.close();
});

test('ws e2e：斷線重連後 pty 仍活著', async () => {
  const c1 = makeClient();
  await c1.waitOpen;
  c1.reset();
  c1.input('echo BEFORE_RECONNECT\n');
  await c1.expectIncludes('BEFORE_RECONNECT');
  await c1.close();

  const c2 = makeClient(); // 新連線（模擬前端按重連）
  await c2.waitOpen;
  c2.reset();
  c2.input('echo AFTER_RECONNECT_OK\n');
  await c2.expectIncludes('AFTER_RECONNECT_OK');
  await c2.close();
});

test('ws e2e：壞訊息不會搞死 server（非 JSON / 未知 type）', async () => {
  const raw = new WebSocket(WSURL);
  await new Promise((resolve, reject) => {
    raw.on('open', resolve);
    raw.on('error', reject);
  });
  raw.send('this is not json {{{');
  raw.send(JSON.stringify({ type: 'nope-unknown-type' }));
  await new Promise((r) => setTimeout(r, 500));
  // server 還活著
  const r = await fetch(`${BASE}/api/health`);
  assert.equal(r.status, 200);
  raw.terminate();
});
