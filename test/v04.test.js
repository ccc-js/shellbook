// shellbook v0.4 e2e：兩本真書的每個 block 照順序跑，全綠才算過
// ＝「每行範例都有人實際點過」的自動化證明。跑完清場。
// 跑法：npm test（node --test test/*.test.js）
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = process.env.TEST_PORT || '3140';
const BASE = `http://127.0.0.1:${PORT}`;
const WSURL = `ws://127.0.0.1:${PORT}/ws/shell`;
const ROOT = path.join(__dirname, '..');
const WS_DIR = path.join(ROOT, 'workspace');

let serverProc = null;

async function waitFor(fn, { timeout = 180000, interval = 50, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

function makeClient() {
  const ws = new WebSocket(WSURL);
  const inbox = [];
  let outBuf = '';
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'output') outBuf += msg.data;
      else inbox.push(msg);
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
    async next(pred, { timeout = 180000 } = {}) {
      return waitFor(
        () => {
          const i = inbox.findIndex(pred);
          return i >= 0 ? inbox.splice(i, 1)[0] : false;
        },
        { timeout, label: 'ws message' }
      );
    },
    outIncludes(s) {
      return outBuf.includes(s);
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

let client = null;

before(async () => {
  serverProc = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SHELLBOOK_TIMEOUT_MS: '180000' },
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
  client = makeClient();
  await client.waitOpen;
});

after(async () => {
  // 清場：書產生的目錄＋docker image（best-effort，不斷言）
  try {
    if (client && client.ws.readyState === 1) {
      client.send({ type: 'run', blockId: 'cleanup', code: `rm -rf "${WS_DIR}/gitbook-play" "${WS_DIR}/demo-proj" && echo CLEANED` });
      await client.next((m) => m.type === 'runDone' && m.blockId === 'cleanup');
      await client.close();
    }
  } catch { /* ignore */ }
  try {
    const p = spawn('docker', ['rmi', '-f', 'shellbook-demo'], { stdio: 'ignore' });
    await new Promise((r) => p.on('exit', r));
  } catch { /* ignore */ }
  if (serverProc) {
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!serverProc.killed) serverProc.kill('SIGKILL');
  }
});

test('三本書都在架上', async () => {
  const list = await (await fetch(`${BASE}/api/books`)).json();
  for (const name of ['demo', 'gitbook', 'fullstack-book']) {
    assert.ok(list.find((b) => b.name === name), `${name} missing`);
  }
});

test('SHELLBOOK_WS 已注入 pty', async () => {
  client.send({ type: 'run', blockId: 'env', code: 'echo "WS=$SHELLBOOK_WS"' });
  await client.next((m) => m.type === 'runStarted' && m.blockId === 'env');
  await client.next((m) => m.type === 'runDone' && m.blockId === 'env' && m.ok === true);
  await waitFor(() => client.outIncludes('workspace'), { timeout: 10000, label: '$SHELLBOOK_WS output' });
});

// 通用：整本書每章每 block 照順序 run，全過
async function runWholeBook(name) {
  const book = await (await fetch(`${BASE}/api/books/${name}`)).json();
  assert.ok(book.chapters.length > 0, `${name} has no chapters`);
  let count = 0;
  for (const ch of book.chapters) {
    const base = ch.file.replace(/\.md$/, '');
    const detail = await (await fetch(`${BASE}/api/books/${name}/ch/${base}`)).json();
    assert.ok(detail.blocks.length > 0, `${name}/${base} has no blocks`);
    for (const b of detail.blocks) {
      count += 1;
      client.send({ type: 'run', blockId: b.id, code: b.code });
      const started = await client.next((m) => m.type === 'runStarted' && m.blockId === b.id);
      assert.equal(started.blockId, b.id);
      const done = await client.next((m) => m.type === 'runDone' && m.blockId === b.id);
      assert.equal(done.blockId, b.id);
      assert.equal(
        done.ok, true,
        `${name}/${base} block ${b.id} FAILED (exit=${done.exitCode}):\n${b.code}`
      );
    }
  }
  return count;
}

test('gitbook：全書 4 章所有範例跑完', async () => {
  const n = await runWholeBook('gitbook');
  assert.equal(n, 10);
});

test('gitbook 跑完：本地遠端真的有東西', async () => {
  client.send({ type: 'run', blockId: 'verify-git', code: `git --git-dir="${WS_DIR}/gitbook-play/upstream.git" log --oneline | head -3` });
  const done = await client.next((m) => m.type === 'runDone' && m.blockId === 'verify-git');
  assert.equal(done.ok, true);
});

test('fullstack-book：全書 5 章所有範例跑完', async () => {
  const n = await runWholeBook('fullstack-book');
  assert.equal(n, 13);
});

test('fullstack 跑完：三件交付物都在', async () => {
  client.send({
    type: 'run',
    blockId: 'verify-fs',
    code: [
      `test -f "${WS_DIR}/demo-proj/sum.js" && echo HAVE_NODE`,
      `test -f "${WS_DIR}/demo-proj/rust-app/src/main.rs" && echo HAVE_RUST`,
      `test -f "${WS_DIR}/demo-proj/Dockerfile" && echo HAVE_DOCKER`,
      `test -f "${WS_DIR}/demo-proj/.github/workflows/ci.yml" && echo HAVE_CI`,
      `docker run --rm shellbook-demo`,
    ].join('\n'),
  });
  const started = await client.next((m) => m.type === 'runStarted' && m.blockId === 'verify-fs');
  assert.equal(started.total, 5);
  const done = await client.next((m) => m.type === 'runDone' && m.blockId === 'verify-fs');
  assert.equal(done.ok, true);
});
