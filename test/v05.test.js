// shellbook v0.5 e2e：多 session 隔離＋deny-list＋上限/回收/audit/大輸出
// 跑法：npm test（node --test test/*.test.js）
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT_A = process.env.TEST_PORT_A || '3141';
const PORT_B = process.env.TEST_PORT_B || '3142';
const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;

let srvA = null;
let srvB = null;

async function waitFor(fn, { timeout = 20000, interval = 50, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function waitServerUp(base) {
  await waitFor(
    async () => {
      try {
        const r = await fetch(`${base}/api/health`);
        return r.ok;
      } catch {
        return false;
      }
    },
    { timeout: 20000, label: `server up ${base}` }
  );
}

// 收到 session 訊息後才算就緒，並記下 id
function connect(base, sessionId) {
  const q = sessionId ? `?session=${encodeURIComponent(sessionId)}` : '';
  const ws = new WebSocket(`ws://127.0.0.1:${new URL(base).port}/ws/shell${q}`);
  const inbox = [];
  let outBuf = '';
  let sid = null;
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'output') outBuf += msg.data;
      else {
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
    get cwd() {
      const m = inbox.find((m) => m.type === 'session');
      return m && m.cwd;
    },
    send(o) {
      ws.send(JSON.stringify(o));
    },
    input(s) {
      ws.send(JSON.stringify({ type: 'input', data: s }));
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
    outIncludes(s) {
      return outBuf.includes(s);
    },
    closed() {
      return ws.readyState >= 2;
    },
    waitClose(timeout = 15000) {
      if (this.closed()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting ws close')), timeout);
        ws.on('close', () => {
          clearTimeout(t);
          resolve();
        });
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
  srvA = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: PORT_A, SHELLBOOK_IDLE_MS: '600000', SHELLBOOK_MAX_SESSIONS: '32' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srvB = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: PORT_B,
      SHELLBOOK_MAX_SESSIONS: '2', SHELLBOOK_IDLE_MS: '2000', SHELLBOOK_SWEEP_MS: '500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await Promise.all([waitServerUp(BASE_A), waitServerUp(BASE_B)]);
});

after(async () => {
  // 只清自己兩台 server 的 sessions（經 API，不碰別台）
  for (const base of [BASE_A, BASE_B]) {
    try {
      const list = await (await fetch(`${base}/api/sessions`)).json();
      for (const s of list) {
        try {
          await fetch(`${base}/api/sessions/${s.id}`, { method: 'DELETE' });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  for (const p of [srvA, srvB]) {
    if (p) {
      p.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (!p.killed) p.kill('SIGKILL');
    }
  }
});

// ================= A：隔離＋防線 =================
test('GET /api/config 回 warn 與上限', async () => {
  const c = await (await fetch(`${BASE_A}/api/config`)).json();
  assert.equal(c.maxSessions, 32); // 本測試檔把 A 台上限調大，避免 session 堆積誤擋
  assert.ok(Array.isArray(c.warn) && c.warn.includes('rm -rf'));
});

test('sessions 隔離：c1 的檔案 c2 看不到', async () => {
  const c1 = connect(BASE_A);
  await c1.waitOpen;
  await waitFor(() => c1.sessionId, { label: 'c1 session' });
  assert.ok(c1.cwd.includes(`sessions/${c1.sessionId}`));
  c1.send({ type: 'run', blockId: 'iso1', code: 'echo FROM_C1 > c1.txt && pwd' });
  await c1.next((m) => m.type === 'runDone' && m.blockId === 'iso1' && m.ok === true);

  const c2 = connect(BASE_A);
  await c2.waitOpen;
  await waitFor(() => c2.sessionId, { label: 'c2 session' });
  assert.notEqual(c2.sessionId, c1.sessionId);
  c2.send({ type: 'run', blockId: 'iso2', code: 'test ! -f c1.txt && echo ISOLATED' });
  await c2.next((m) => m.type === 'runDone' && m.blockId === 'iso2' && m.ok === true);
  await c1.close();
  await c2.close();
});

test('?session= 可 reattach：回到同一沙盒', async () => {
  const c1 = connect(BASE_A);
  await c1.waitOpen;
  await waitFor(() => c1.sessionId, { label: 'c1 session' });
  c1.send({ type: 'run', blockId: 'a1', code: 'echo REATTACH_PROBE > probe.txt' });
  await c1.next((m) => m.type === 'runDone' && m.blockId === 'a1' && m.ok === true);
  const id = c1.sessionId;
  await c1.close();

  const c2 = connect(BASE_A, id); // 同 id 接回
  await c2.waitOpen;
  await waitFor(() => c2.sessionId, { label: 'c2 session' });
  assert.equal(c2.sessionId, id);
  c2.send({ type: 'run', blockId: 'a2', code: 'test -f probe.txt && echo SHARED_OK' });
  await c2.next((m) => m.type === 'runDone' && m.blockId === 'a2' && m.ok === true);
  await c2.close();
});

test('run 阻擋是原子的：第一行也不執行', async () => {
  const c = connect(BASE_A);
  await c.waitOpen;
  await waitFor(() => c.sessionId, { label: 'session' });
  c.send({ type: 'run', blockId: 'at1', code: 'echo PROBE_MARKER > probe.txt && rm -rf /' });
  const blocked = await c.next((m) => m.type === 'blocked' && m.blockId === 'at1');
  assert.ok(blocked.reason);
  assert.equal(blocked.index, 0); // 單步一切（&& 同行）→ index 0
  const done = await c.next((m) => m.type === 'runDone' && m.blockId === 'at1');
  assert.equal(done.ok, false);
  assert.equal(done.error, 'blocked');
  c.send({ type: 'run', blockId: 'at2', code: 'test ! -f probe.txt && echo ATOMIC_OK' });
  await c.next((m) => m.type === 'runDone' && m.blockId === 'at2' && m.ok === true);
  await c.close();
});

test('step 阻擋：不建游標，之後正常 step 不受影響', async () => {
  const c = connect(BASE_A);
  await c.waitOpen;
  await waitFor(() => c.sessionId, { label: 'session' });
  c.send({ type: 'step', blockId: 'st1', code: 'echo hi\nmkfs' });
  const blocked = await c.next((m) => m.type === 'blocked' && m.blockId === 'st1');
  assert.equal(blocked.index, 1);
  await c.next((m) => m.type === 'stepResult' && m.blockId === 'st1' && m.ok === false);
  c.send({ type: 'step', blockId: 'st2', code: 'echo STEP_AFTER_BLOCK' });
  const r = await c.next((m) => m.type === 'stepResult' && m.blockId === 'st2');
  assert.equal(r.done, true);
  await c.close();
});

test('手打守衛：直打 mkfs 被吃掉；正常指令照跑', async () => {
  const c = connect(BASE_A);
  await c.waitOpen;
  await waitFor(() => c.sessionId, { label: 'session' });
  c.input('mkfs');
  c.input('\r');
  await waitFor(() => c.outIncludes('阻擋'), { timeout: 10000, label: 'blocked warning' });
  c.input('echo TYPED_OK\r');
  await waitFor(() => c.outIncludes('TYPED_OK'), { timeout: 10000, label: 'typed echo' });
  // shell 還活著
  c.send({ type: 'run', blockId: 'm1', code: 'echo ALIVE_OK' });
  await c.next((m) => m.type === 'runDone' && m.blockId === 'm1' && m.ok === true);
  await c.close();
});

test('大輸出：result 被截斷、server 沒死', async () => {
  const c = connect(BASE_A);
  await c.waitOpen;
  await waitFor(() => c.sessionId, { label: 'session' });
  c.send({ type: 'run', blockId: 'big1', code: 'seq 1 100000' });
  const res = await c.next((m) => m.type === 'result' && m.blockId === 'big1');
  assert.equal(res.exitCode, 0);
  await c.next((m) => m.type === 'runDone' && m.blockId === 'big1' && m.ok === true);
  const r = await fetch(`${BASE_A}/api/health`);
  assert.equal(r.status, 200);
  await c.close();
});

test('audit log：run 與 blocked 都有記', async () => {
  const c = connect(BASE_A);
  await c.waitOpen;
  await waitFor(() => c.sessionId, { label: 'session' });
  const id = c.sessionId;
  c.send({ type: 'run', blockId: 'au1', code: 'echo AUDIT_ME' });
  await c.next((m) => m.type === 'runDone' && m.blockId === 'au1');
  c.send({ type: 'run', blockId: 'au2', code: 'rm -rf /' });
  await c.next((m) => m.type === 'runDone' && m.blockId === 'au2');
  await c.close();
  const log = fs.readFileSync(path.join(ROOT, 'logs', `${id}.log`), 'utf8');
  assert.ok(log.includes('"kind":"run"') && log.includes('au1'), 'run audit missing');
  assert.ok(log.includes('"kind":"blocked"'), 'blocked audit missing');
  assert.ok(log.includes('"kind":"result"') && log.includes('"exitCode":0'), 'result audit missing');
});

test('DELETE session：目錄消失、舊 id 變成新的', async () => {
  const c = connect(BASE_A);
  await c.waitOpen;
  await waitFor(() => c.sessionId, { label: 'session' });
  const id = c.sessionId;
  await c.close();
  const del = await fetch(`${BASE_A}/api/sessions/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const list = await (await fetch(`${BASE_A}/api/sessions`)).json();
  assert.ok(!list.find((s) => s.id === id), 'session still listed');
  assert.ok(!fs.existsSync(path.join(ROOT, 'workspace', 'sessions', id)), 'session dir still exists');
  const c2 = connect(BASE_A, id); // 舊 id 接不回去，應配到新的
  await c2.waitOpen;
  await waitFor(() => c2.sessionId, { label: 'session' });
  assert.notEqual(c2.sessionId, id);
  await c2.close();
});

// ================= B：上限＋回收 =================
test('上限：第三個連線被拒', async () => {
  const w1 = connect(BASE_B);
  await w1.waitOpen;
  await waitFor(() => w1.sessionId, { label: 'w1 session' });
  const w2 = connect(BASE_B);
  await w2.waitOpen;
  await waitFor(() => w2.sessionId, { label: 'w2 session' });
  const w3 = connect(BASE_B);
  await w3.waitOpen;
  const err = await w3.next((m) => m.type === 'error' && m.error === 'max-sessions', { timeout: 10000 });
  assert.equal(err.max, 2);
  await w3.waitClose();
  const id1 = w1.sessionId;
  const id2 = w2.sessionId;
  await w1.close();
  await w2.close();
  // 清掉佔位的 sessions，否則下一個測試會被上限擋
  for (const id of [id1, id2]) {
    await fetch(`${BASE_B}/api/sessions/${id}`, { method: 'DELETE' });
  }
});

test('閒置回收：session 超時被收掉', async () => {
  const w = connect(BASE_B);
  await w.waitOpen;
  await waitFor(() => w.sessionId, { label: 'w session' });
  const id = w.sessionId;
  await w.waitClose(15000); // idle 2s＋sweep 0.5s 內應關閉
  const list = await (await fetch(`${BASE_B}/api/sessions`)).json();
  assert.ok(!list.find((s) => s.id === id), 'reaped session still listed');
});
