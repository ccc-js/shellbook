// shellbook v0.6 — 學習進度：每本書每 block 的 done/failed＋expect 對照＋次數
// 存檔：progress/<book>.json（單機單學員，跨 tab 共用；目錄可由 env 覆寫供測試）
const fs = require('fs');
const path = require('path');

const NAME_RE = /^[a-z0-9-]+$/;

function dir() {
  return process.env.SHELLBOOK_PROGRESS_DIR || path.join(__dirname, '..', 'progress');
}

function fileOf(book) {
  if (!NAME_RE.test(book)) {
    const e = new Error(`invalid book name: ${book}`);
    e.status = 400;
    throw e;
  }
  return path.join(dir(), `${book}.json`);
}

function getBook(book) {
  try {
    return JSON.parse(fs.readFileSync(fileOf(book), 'utf8'));
  } catch {
    return { book, blocks: {} };
  }
}

function record(book, blockId, { status, exitCode = null, expectMet = null } = {}) {
  fs.mkdirSync(dir(), { recursive: true });
  const data = getBook(book);
  const prev = data.blocks[blockId] || { runs: 0 };
  data.blocks[blockId] = {
    status, // 'done' | 'failed'
    exitCode,
    expectMet,
    runs: (prev.runs || 0) + 1,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(fileOf(book), JSON.stringify(data, null, 2));
  return data.blocks[blockId];
}

// chapter 為章檔基名（如 ch01-hello）時只清該章；不給則整本重置
function reset(book, chapter) {
  const data = getBook(book);
  if (chapter) {
    for (const id of Object.keys(data.blocks)) {
      if (id === chapter || id.startsWith(`${chapter}-`)) delete data.blocks[id];
    }
  } else {
    data.blocks = {};
  }
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(fileOf(book), JSON.stringify(data, null, 2));
  return data;
}

module.exports = { getBook, record, reset };
