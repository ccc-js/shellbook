// shellbook v0.2 e2e：Book API + 範例書真跑驗證
// 跑法：npm test（node --test test/*.test.js）
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = process.env.TEST_PORT || '3138';
const BASE = `http://127.0.0.1:${PORT}`;
const WSURL = `ws://127.0.0.1:${PORT}/ws/shell`;
const ROOT = path.join(__dirname, '..');

let serverProc = null;

async function waitFor(fn, { timeout = 15000, interval = 100, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

function clean(buf) {
  return buf
    .replace(/\r/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/[^\x20-\x7e\n_\/.-]/g, '');
}

function makeClient() {
  const ws = new WebSocket(WSURL);
  let buf = '';
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'output') buf += msg.data;
    } catch { /* ignore */ }
  });
  const waitOpen = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return {
    ws,
    waitOpen,
    reset() {
      buf = '';
    },
    run(code) {
      ws.send(JSON.stringify({ type: 'input', data: code + '\n' }));
    },
    async expectIncludes(needle, { timeout = 15000 } = {}) {
      await waitFor(() => clean(buf).includes(needle), {
        timeout,
        label: `output includes ${JSON.stringify(needle)}`,
      });
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
    env: { ...process.env, PORT },
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
  if (serverProc) {
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!serverProc.killed) serverProc.kill('SIGKILL');
  }
});

// ---------- API ----------
test('GET /api/books 列出 demo 書', async () => {
  const r = await fetch(`${BASE}/api/books`);
  assert.equal(r.status, 200);
  const list = await r.json();
  const demo = list.find((b) => b.name === 'demo');
  assert.ok(demo, 'demo book missing');
  assert.equal(demo.title, '示範書：shell 第一課');
});

test('GET /api/books/demo 章節兩章 + 標題', async () => {
  const r = await fetch(`${BASE}/api/books/demo`);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.chapters.length, 2);
  assert.ok(b.chapters[0].title.includes('打招呼'));
  assert.ok(b.chapters[1].title.includes('檔案'));
});

test('GET ch01：2 個 blocks（run+step），無標籤的不收', async () => {
  const r = await fetch(`${BASE}/api/books/demo/ch/ch01-hello`);
  assert.equal(r.status, 200);
  const ch = await r.json();
  assert.equal(ch.blocks.length, 2);
  assert.equal(ch.blocks[0].mode, 'run');
  assert.equal(ch.blocks[0].id, 'ch01-hello-1');
  assert.ok(ch.blocks[0].code.includes('echo hello shellbook'));
  assert.equal(ch.blocks[0].expect, 'hello');
  assert.equal(ch.blocks[1].mode, 'step');
});

test('GET ch02：cwd/expect 解析正確', async () => {
  const r = await fetch(`${BASE}/api/books/demo/ch/ch02-files.md`); // 帶 .md 也要通
  assert.equal(r.status, 200);
  const ch = await r.json();
  assert.equal(ch.blocks.length, 2);
  assert.equal(ch.blocks[0].cwd, 'workspace/demo-play');
  assert.equal(ch.blocks[1].expect, 'apple');
});

test('404：不存在的書 / 章', async () => {
  const r1 = await fetch(`${BASE}/api/books/no-such-book`);
  assert.equal(r1.status, 404);
  const r2 = await fetch(`${BASE}/api/books/demo/ch/no-such-ch`);
  assert.equal(r2.status, 404);
});

test('400：路徑跳脫被擋', async () => {
  const r = await fetch(`${BASE}/api/books/demo/ch/..%2Fserver`);
  assert.ok([400, 404].includes(r.status), `status=${r.status}`);
});

test('靜態 vendor：marked 可取回', async () => {
  const r = await fetch(`${BASE}/vendor/marked/marked.umd.js`);
  assert.equal(r.status, 200);
});

// ---------- 範例書真跑（v0.2「插入→Enter」流程的後端等價驗證） ----------
test('e2e：demo ch01 範例照書執行，全過', async () => {
  const ch = await (await fetch(`${BASE}/api/books/demo/ch/ch01-hello`)).json();
  const c = makeClient();
  await c.waitOpen;
  for (const b of ch.blocks) {
    c.reset();
    c.run(b.code); // 等同前端「插入」後使用者按 Enter
    // 每行都該出現（取第一個有意義 token 驗證）
    const firstLine = b.code.split('\n')[0];
    if (firstLine.startsWith('echo ')) {
      await c.expectIncludes(firstLine.replace(/^echo\s+/, '').split(' ')[0]);
    } else {
      await c.expectIncludes('workspace');
    }
  }
  await c.close();
});

test('e2e：demo ch02 建檔+grep 全過（跑完清場）', async () => {
  const ch = await (await fetch(`${BASE}/api/books/demo/ch/ch02-files`)).json();
  const c = makeClient();
  await c.waitOpen;
  c.reset();
  c.run(ch.blocks[0].code);
  await c.expectIncludes('apple banana apple', { timeout: 20000 });
  c.reset();
  c.run(ch.blocks[1].code);
  await c.expectIncludes('apple', { timeout: 20000 });
  // 清場：刪掉範例產生的檔案
  c.reset();
  c.run('rm -rf demo-play && echo CLEANED');
  await c.expectIncludes('CLEANED');
  await c.close();
});
