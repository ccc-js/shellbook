// shellbook v0.7 e2e：fullstack-github 全書真跑（未授權路徑）＋mutating 指令靜態守衛
// 策略：GH_TOKEN 放假值，強制走「手動指引」分支，零帳號異動；
// 真授權路徑由使用者實際跑書時覆蓋。
// 跑法：npm test（node --test test/*.test.js）
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = process.env.TEST_PORT || '3145';
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');
const GHBOOK = path.join(ROOT, 'books', 'fullstack-github');

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
    async next(pred, { timeout = 180000 } = {}) {
      return waitFor(
        () => {
          const i = inbox.findIndex(pred);
          return i >= 0 ? inbox.splice(i, 1)[0] : false;
        },
        { timeout, label: 'ws message' }
      );
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
    env: {
      ...process.env, PORT,
      SHELLBOOK_TIMEOUT_MS: '180000',
      SHELLBOOK_MAX_SESSIONS: '64',
      GH_TOKEN: 'bogus-token-for-shellbook-tests', // 強制未授權路徑：就算機器有登入也不動帳號
    },
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
  client = connect();
  await client.waitOpen;
  await waitFor(() => client.sessionId, { label: 'session' });
});

after(async () => {
  try {
    if (client && client.ws.readyState === 1) {
      client.send({ type: 'run', blockId: 'cleanup', code: 'rm -rf "$SHELLBOOK_WS/demo-proj" "$SHELLBOOK_WS/Spoon-Knife" && echo CLEANED' });
      await client.next((m) => m.type === 'runDone' && m.blockId === 'cleanup');
      await client.close();
    }
  } catch { /* ignore */ }
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
});

// ---------- 靜態守衛：mutating 指令必須包在授權檢查裡 ----------
test('靜態：危險 gh 指令全被 guard 包住，互動/刪除指令零出現', async () => {
  const { parseBlocks } = require('../src/books');
  const files = fs.readdirSync(GHBOOK).filter((f) => f.endsWith('.md'));
  assert.ok(files.length === 9, `expect 9 chapters, got ${files.length}`);
  // 唯讀 gh（version/auth status/workflow|run|pr list/api）免 guard；會動帳號的一律要包
  const MUTATING = ['gh repo create', 'gh repo fork', 'gh repo clone', 'gh repo delete', 'gh pr create', 'gh pr merge', 'gh workflow run', 'git push'];
  let runnable = 0;
  for (const f of files) {
    const md = fs.readFileSync(path.join(GHBOOK, f), 'utf8');
    const base = f.replace(/\.md$/, '');
    for (const b of parseBlocks(md, base)) {
      runnable++;
      assert.ok(!b.code.includes('gh auth login'), `${b.id}: gh auth login 不可執行`);
      assert.ok(!b.code.includes('gh repo delete'), `${b.id}: gh repo delete 禁止`);
      if (MUTATING.some((k) => b.code.includes(k))) {
        assert.ok(b.code.includes('gh auth status'), `${b.id}: mutating 指令必須包授權檢查`);
        assert.ok(b.code.includes('GH_'), `${b.id}: guarded 塊必須回報 GH_ 狀態 token`);
      }
    }
  }
  assert.ok(runnable >= 20, `runnable blocks too few: ${runnable}`);
});

test('API：fullstack-github 9 章上架', async () => {
  const b = await (await fetch(`${BASE}/api/books/fullstack-github`)).json();
  assert.equal(b.chapters.length, 9);
  assert.ok(b.title.includes('GitHub'));
});

// ---------- 全書真跑（未授權 → 手動指引分支，全綠） ----------
test('fullstack-github：全書 9 章所有範例跑完', async () => {
  const book = await (await fetch(`${BASE}/api/books/fullstack-github`)).json();
  let count = 0;
  for (const ch of book.chapters) {
    const base = ch.file.replace(/\.md$/, '');
    const detail = await (await fetch(`${BASE}/api/books/fullstack-github/ch/${base}`)).json();
    assert.ok(detail.blocks.length > 0, `${base} has no blocks`);
    for (const b of detail.blocks) {
      count++;
      client.send({ type: 'run', blockId: b.id, code: b.code });
      const started = await client.next((m) => m.type === 'runStarted' && m.blockId === b.id);
      assert.ok(started.total > 0);
      const done = await client.next((m) => m.type === 'runDone' && m.blockId === b.id);
      assert.equal(done.ok, true, `${base} block ${b.id} FAILED:\n${b.code}`);
    }
  }
  assert.equal(count, 23);
});
