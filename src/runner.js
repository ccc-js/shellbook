// shellbook v0.3 — 執行佇列：在共用互動式 pty 上逐行執行，擷取 exit code
// 技巧：每行後面跟一句 `echo __SHELLBOOK_END_<seq>__:$?`，
// 用 marker 從 pty 輸出流中切出該行的結束與 exit code。
// 保證：同一時間只有一行在跑（FIFO），run 全跑失敗即停，step 一次只跑一行。
const { splitSteps } = require('./steps');

const MARK_RE = /__SHELLBOOK_END_(\d+)__:(\d+)/;
const mark = (seq) => `__SHELLBOOK_END_${seq}__`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Runner {
  constructor({ write, timeoutMs = 30000, maxOutputBytes = 65536, onEvent = null }) {
    this.write = write;
    this.timeoutMs = timeoutMs;
    this.maxOutputBytes = maxOutputBytes;
    this.onEvent = onEvent;
    this.seq = 0;
    this.queue = [];
    this.busy = false;
    this.active = null; // { seq, buf, t0, timer, done, finish }
    this.stepSessions = new Map(); // ws -> { blockId, code, lines, index }
  }

  // ---- pty 輸出嗅探（server 的 onData 轉呼叫） ----
  sniff(data) {
    const a = this.active;
    if (!a || a.done) return;
    a.buf += data;
    const m = a.buf.match(MARK_RE);
    if (m && Number(m[1]) === a.seq) a.finish({ exitCode: Number(m[2]), timeout: false });
  }

  execLine(line) {
    return new Promise((resolve) => {
      const seq = ++this.seq;
      const t0 = Date.now();
      const state = {
        seq,
        buf: '',
        t0,
        timer: null,
        done: false,
        finish: (res) => {
          if (state.done) return;
          state.done = true;
          clearTimeout(state.timer);
          if (this.active === state) this.active = null;
          let output = state.buf;
          if (output.length > this.maxOutputBytes) {
            output = output.slice(output.length - this.maxOutputBytes)
              + `\n[output truncated, kept last ${this.maxOutputBytes} bytes]\n`;
          }
          resolve({ ...res, durationMs: Date.now() - t0, output });
        },
      };
      this.active = state;
      this.write(line + '\n');
      this.write(`echo ${mark(seq)}:$?\n`);
      state.timer = setTimeout(() => {
        this.write('\x03'); // 超時先 Ctrl+C
        state.timer = setTimeout(() => {
          state.finish({ exitCode: null, timeout: true });
        }, 2000);
      }, this.timeoutMs);
    });
  }

  enqueue(task) {
    this.queue.push(task);
    this.pump();
  }

  async pump() {
    if (this.busy) return;
    const task = this.queue.shift();
    if (!task) return;
    this.busy = true;
    try {
      await task();
    } finally {
      this.busy = false;
      this.pump();
    }
  }

  // ---- 全跑：逐行，失敗即停 ----
  handleRun(ws, { blockId, code }) {
    const send = (o) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(o));
      if (this.onEvent) {
        try {
          this.onEvent(o, ws);
        } catch { /* ignore */ }
      }
    };
    const lines = splitSteps(String(code || ''));
    if (!lines.length) {
      send({ type: 'runDone', blockId, ok: false, error: 'empty' });
      return;
    }
    this.enqueue(async () => {
      send({ type: 'runStarted', blockId, total: lines.length, lines });
      for (let i = 0; i < lines.length; i++) {
        await sleep(20);
        const r = await this.execLine(lines[i]);
        send({
          type: 'result', blockId, index: i, total: lines.length,
          line: lines[i], exitCode: r.exitCode, timeout: !!r.timeout, durationMs: r.durationMs,
          output: r.output,
        });
        if (r.timeout || r.exitCode !== 0) {
          send({ type: 'runDone', blockId, ok: false, failedIndex: i, exitCode: r.exitCode, timeout: !!r.timeout });
          return;
        }
      }
      send({ type: 'runDone', blockId, ok: true });
    });
  }

  // ---- 單步：每個 ws 一個 session 游標，調一次跑一行 ----
  handleStep(ws, { blockId, code }) {
    const send = (o) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(o));
      if (this.onEvent) {
        try {
          this.onEvent(o, ws);
        } catch { /* ignore */ }
      }
    };
    code = String(code || '');
    let sess = this.stepSessions.get(ws);
    if (!sess || sess.blockId !== blockId || sess.code !== code) {
      const lines = splitSteps(code);
      if (!lines.length) {
        send({ type: 'stepResult', blockId, index: 0, total: 0, done: true, ok: false, error: 'empty' });
        return;
      }
      sess = { blockId, code, lines, index: 0 };
      this.stepSessions.set(ws, sess);
      send({ type: 'stepStarted', blockId, total: lines.length, lines });
    }
    if (sess.index >= sess.lines.length) {
      send({ type: 'stepResult', blockId, index: sess.index, total: sess.lines.length, done: true, ok: true });
      return;
    }
    const i = sess.index;
    const line = sess.lines[i];
    this.enqueue(async () => {
      await sleep(20);
      const r = await this.execLine(line);
      sess.index += 1;
      const done = sess.index >= sess.lines.length;
      send({
        type: 'stepResult', blockId, index: i, total: sess.lines.length,
        line, exitCode: r.exitCode, timeout: !!r.timeout, durationMs: r.durationMs, done,
        output: r.output,
      });
      if (done) this.stepSessions.delete(ws);
    });
  }

  handleReset(ws, { blockId }) {
    const sess = this.stepSessions.get(ws);
    if (sess && (!blockId || sess.blockId === blockId)) this.stepSessions.delete(ws);
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'stepReset', blockId }));
  }

  dropWs(ws) {
    this.stepSessions.delete(ws);
  }
}

module.exports = { Runner, MARK_RE };
