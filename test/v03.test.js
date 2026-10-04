// shellbook v0.3 e2e：run（全跑）/ step（單步）經真 pty 驗證
// 跑法：npm test（node --test test/*.test.js）
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = process.env.TEST_PORT || '3139';
const BASE = `http://127.0.0.1:${PORT}`;
const WSURL = `ws://127.0.0.1:${PORT}/ws/shell`;
const ROOT = path.join(__dirname, '..');

let serverProc = null;

async function waitFor(fn, { timeout = 20000, interval = 50, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

// 收指定 type 的訊息（依序），output 另計
function makeClient() {
  const ws = new WebSocket(WSURL);
  const inbox = []; // {type, ...}
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
    // 等待符合條件的下一個訊息（消耗式）
    async next(pred, { timeout = 20000 } = {}) {
      const found = await waitFor(
        () => {
          const i = inbox.findIndex(pred);
          return i >= 0 ? inbox.splice(i, 1)[0] : false;
        },
        { timeout, label: 'ws message' }
      );
      return found;
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
  if (serverProc) {
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!serverProc.killed) serverProc.kill('SIGKILL');
  }
});

test('run：單行全跑回 exit 0 + runDone ok', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.send({ type: 'run', blockId: 't1', code: 'echo RUN_SINGLE_OK' });
  const started = await c.next((m) => m.type === 'runStarted');
  assert.equal(started.total, 1);
  const res = await c.next((m) => m.type === 'result');
  assert.equal(res.exitCode, 0);
  assert.equal(res.timeout, false);
  assert.ok(typeof res.durationMs === 'number');
  const done = await c.next((m) => m.type === 'runDone');
  assert.equal(done.ok, true);
  await c.close();
});

test('run：多行全過 + 續行接成一步', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.send({ type: 'run', blockId: 't2', code: 'echo A1\necho B2 \\\n  tail\necho C3' });
  const started = await c.next((m) => m.type === 'runStarted');
  assert.equal(started.total, 3); // 續行併成一行
  for (let i = 0; i < 3; i++) {
    const res = await c.next((m) => m.type === 'result');
    assert.equal(res.index, i);
    assert.equal(res.exitCode, 0);
  }
  const done = await c.next((m) => m.type === 'runDone');
  assert.equal(done.ok, true);
  await c.close();
});

test('run：失敗即停（第三行不該執行）', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.send({ type: 'run', blockId: 't3', code: 'echo FIRST_LINE\nfalse\necho SHOULD_NOT_APPEAR_XYZ' });
  await c.next((m) => m.type === 'runStarted');
  const r0 = await c.next((m) => m.type === 'result');
  assert.equal(r0.exitCode, 0);
  const r1 = await c.next((m) => m.type === 'result');
  assert.notEqual(r1.exitCode, 0);
  const done = await c.next((m) => m.type === 'runDone');
  assert.equal(done.ok, false);
  assert.equal(done.failedIndex, 1);
  // 確認第三行真的沒跑
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(c.outIncludes('SHOULD_NOT_APPEAR_XYZ'), false);
  // shell 還活著
  c.send({ type: 'run', blockId: 't3b', code: 'echo STILL_ALIVE' });
  await c.next((m) => m.type === 'runDone' && m.ok === true);
  await c.close();
});

test('run：heredoc 整段执行', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.send({ type: 'run', blockId: 't4', code: 'cat <<EOF\nHEREDOC_LINE_77\nEOF' });
  const started = await c.next((m) => m.type === 'runStarted');
  assert.equal(started.total, 1);
  const res = await c.next((m) => m.type === 'result');
  assert.equal(res.exitCode, 0);
  await c.next((m) => m.type === 'runDone' && m.ok === true);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(c.outIncludes('HEREDOC_LINE_77'));
  await c.close();
});

test('run：空 code 回 error，不卡住佇列', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.send({ type: 'run', blockId: 't5', code: '   \n  ' });
  const done = await c.next((m) => m.type === 'runDone');
  assert.equal(done.ok, false);
  assert.equal(done.error, 'empty');
  c.send({ type: 'run', blockId: 't5b', code: 'echo QUEUE_ALIVE' });
  await c.next((m) => m.type === 'runDone' && m.ok === true);
  await c.close();
});

test('step：一次一行，游標推進到 done', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.send({ type: 'step', blockId: 's1', code: 'echo STEP_ONE\necho STEP_TWO' });
  const started = await c.next((m) => m.type === 'stepStarted');
  assert.equal(started.total, 2);
  const r0 = await c.next((m) => m.type === 'stepResult');
  assert.equal(r0.index, 0);
  assert.equal(r0.exitCode, 0);
  assert.equal(r0.done, false);
  c.send({ type: 'step', blockId: 's1', code: 'echo STEP_ONE\necho STEP_TWO' });
  const r1 = await c.next((m) => m.type === 'stepResult');
  assert.equal(r1.index, 1);
  assert.equal(r1.done, true);
  await c.close();
});

test('step：換 block 自動換游標；reset 清游標', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.send({ type: 'step', blockId: 'sA', code: 'echo AAA' });
  await c.next((m) => m.type === 'stepStarted');
  await c.next((m) => m.type === 'stepResult' && m.done === true);
  // 同一 session 換 block：應收到新的 stepStarted
  c.send({ type: 'step', blockId: 'sB', code: 'echo BBB\necho CCC' });
  const st = await c.next((m) => m.type === 'stepStarted');
  assert.equal(st.blockId, 'sB');
  assert.equal(st.total, 2);
  await c.next((m) => m.type === 'stepResult');
  c.send({ type: 'reset', blockId: 'sB' });
  await c.next((m) => m.type === 'stepReset');
  // reset 後再 step 應從頭（再一次 stepStarted）
  c.send({ type: 'step', blockId: 'sB', code: 'echo BBB\necho CCC' });
  const st2 = await c.next((m) => m.type === 'stepStarted');
  assert.equal(st2.total, 2);
  const r = await c.next((m) => m.type === 'stepResult');
  assert.equal(r.index, 0);
  await c.close();
});

test('佇列：連送兩個 run，依序完成', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.send({ type: 'run', blockId: 'q1', code: 'echo QUEUE_Q1' });
  c.send({ type: 'run', blockId: 'q2', code: 'echo QUEUE_Q2' });
  const d1 = await c.next((m) => m.type === 'runDone');
  const d2 = await c.next((m) => m.type === 'runDone');
  assert.equal(d1.blockId, 'q1');
  assert.equal(d2.blockId, 'q2');
  assert.equal(d1.ok, true);
  assert.equal(d2.ok, true);
  await c.close();
});

test('手打 input 與 run 並存：server 不崩', async () => {
  const c = makeClient();
  await c.waitOpen;
  c.send({ type: 'input', data: 'echo MANUAL_MIX\n' });
  c.send({ type: 'run', blockId: 'm1', code: 'echo RUN_MIX' });
  await c.next((m) => m.type === 'runDone' && m.ok === true);
  const r = await fetch(`${BASE}/api/health`);
  assert.equal(r.status, 200);
  await c.close();
});
