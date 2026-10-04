#!/usr/bin/env node
// shellbook CLI（v0.8）：npx shellbook [book] [--port N] [--host H] [--books-dir DIR] [--open]
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function usage(exitCode = 0) {
  console.log(`shellbook — Book + Shell 互動學習平台

用法：
  shellbook [book] [選項]

參數：
  book               開啟後預選的書（book.json 的 name，如 gitbook）

選項：
  --port N           埠號（預設 3000，也可用 PORT）
  --host H           綁定位址（預設 127.0.0.1，只聽本機；對外請顯式指定）
  --books-dir DIR    書籍目錄（預設內建 books/）
  --open             啟動後開瀏覽器
  -h, --help         顯示本說明

範例：
  shellbook gitbook --open
  shellbook --port 3000 --books-dir ./my-books --open
`);
  process.exit(exitCode);
}

const args = process.argv.slice(2);
const opts = { book: null, port: null, host: null, booksDir: null, open: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-h' || a === '--help') usage(0);
  else if (a === '--port') opts.port = args[++i];
  else if (a === '--host') opts.host = args[++i];
  else if (a === '--books-dir') opts.booksDir = args[++i];
  else if (a === '--open') opts.open = true;
  else if (a.startsWith('--')) {
    console.error(`未知選項：${a}`);
    usage(1);
  } else if (!opts.book) opts.book = a;
  else {
    console.error(`多餘參數：${a}`);
    usage(1);
  }
}

if (opts.port) process.env.PORT = opts.port;
if (opts.host) process.env.SHELLBOOK_HOST = opts.host;
if (opts.booksDir) process.env.SHELLBOOK_BOOKS_DIR = path.resolve(opts.booksDir);

const port = process.env.PORT || '3000';
const host = process.env.SHELLBOOK_HOST || '127.0.0.1';
const displayHost = host === '0.0.0.0' ? 'localhost' : host;
let url = `http://${displayHost}:${port}/`;
if (opts.book) url += `?book=${encodeURIComponent(opts.book)}`;

require('../server.js');

if (opts.open) {
  setTimeout(() => {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    const r = spawnSync(cmd, [url], { stdio: 'ignore', shell: process.platform === 'win32' });
    if (r.error) console.error(`（打不開瀏覽器，請手動開 ${url}）`);
  }, 800);
}
