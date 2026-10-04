// shellbook v0.8：CLI＋localhost 預設＋books-dir＋marker 鹽
// 跑法：npm test（node --test test/*.test.js）
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT_CLI = process.env.TEST_PORT_CLI || '3147';
const PORT_DIR = process.env.TEST_PORT_DIR || '3148';

let cli = null;
after(() => {
  if (cli) cli.kill('SIGKILL');
});

async function waitFor(fn, { timeout = 30000, interval = 100, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function waitServerUp(port) {
  await waitFor(
    async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`);
        return r.ok;
      } catch {
        return false;
      }
    },
    { timeout: 25000, label: `server up ${port}` }
  );
}

describe('CLI', () => {
  test('--help 回用法，exit 0', () => {
    const r = spawnSync('node', ['bin/shellbook.js', '--help'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('--port') && r.stdout.includes('--books-dir'));
  });

  test('未知選項 exit 1', () => {
    const r = spawnSync('node', ['bin/shellbook.js', '--nope'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 1);
  });

  test('CLI 用自訂 port 啟動，health 通', async () => {
    cli = spawn('node', ['bin/shellbook.js', '--port', PORT_CLI], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    await waitServerUp(PORT_CLI);
    const j = await (await fetch(`http://127.0.0.1:${PORT_CLI}/api/health`)).json();
    assert.equal(j.ok, true);
  });

  test('--books-dir 指向別處的書', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-books-'));
    const mini = path.join(tmp, 'minibook');
    fs.mkdirSync(mini);
    fs.writeFileSync(path.join(mini, 'book.json'), JSON.stringify({
      name: 'minibook', title: '迷你書', version: '0.0.1', chapters: ['ch01.md'],
    }));
    fs.writeFileSync(path.join(mini, 'ch01.md'), '# 第一章\n\n```sh #run\necho MINI_OK\n```\n');
    const srv = spawn('node', ['bin/shellbook.js', '--port', PORT_DIR, '--books-dir', tmp], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await waitServerUp(PORT_DIR);
      const list = await (await fetch(`http://127.0.0.1:${PORT_DIR}/api/books`)).json();
      assert.ok(list.some((b) => b.name === 'minibook'), 'minibook missing');
      assert.ok(!list.some((b) => b.name === 'gitbook'), 'should not see built-in books');
      const ch = await (await fetch(`http://127.0.0.1:${PORT_DIR}/api/books/minibook/ch/ch01`)).json();
      assert.equal(ch.blocks.length, 1);
    } finally {
      srv.kill('SIGKILL');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('config 預設 host 是 127.0.0.1', async () => {
    const c = await (await fetch(`http://127.0.0.1:${PORT_CLI}/api/config`)).json();
    assert.equal(c.host, '127.0.0.1');
  });

  test('每個 Runner 鹽不同', () => {
    const { Runner } = require('../src/runner');
    const a = new Runner({ write: () => {} });
    const b = new Runner({ write: () => {} });
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.mark(1), b.mark(1));
  });

  test('舊格式 marker 偽造不了結案', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT_CLI}/ws/shell`);
    const inbox = [];
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.type !== 'output') inbox.push(m);
      } catch { /* ignore */ }
    });
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    // 若沿用舊版固定 marker，第一行就會被誤認為結案，SPOOF_PROBE 永遠跑不到
    ws.send(JSON.stringify({ type: 'run', blockId: 'sp1', code: 'echo __SHELLBOOK_END_1__:0\necho SPOOF_PROBE' }));
    const done = await waitFor(
      () => {
        const i = inbox.findIndex((m) => m.type === 'runDone' && m.blockId === 'sp1');
        return i >= 0 ? inbox.splice(i, 1)[0] : false;
      },
      { label: 'spoof runDone' }
    );
    assert.equal(done.ok, true);
    ws.close();
  });

  test('前端靜態：?book= 預選鉤子', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    assert.ok(html.includes('URLSearchParams') && html.includes("get('book')"));
  });
});
