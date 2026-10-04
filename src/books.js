// shellbook v0.2 — book 解析：book.json 驗證 + markdown code fence 抽取
const fs = require('fs');
const path = require('path');

const BOOKS_DIR = path.join(__dirname, '..', 'books');
const NAME_RE = /^[a-z0-9-]+$/;
const RUN_LANGS = new Set(['sh', 'bash', 'shell', 'zsh']);

function booksDir() {
  return BOOKS_DIR;
}

function assertSafeName(name) {
  if (!NAME_RE.test(name)) {
    const e = new Error(`invalid book name: ${name}`);
    e.status = 400;
    throw e;
  }
}

function bookPath(name) {
  assertSafeName(name);
  return path.join(BOOKS_DIR, name);
}

function readBookMeta(name) {
  const dir = bookPath(name);
  const f = path.join(dir, 'book.json');
  if (!fs.existsSync(f)) {
    const e = new Error(`book not found: ${name}`);
    e.status = 404;
    throw e;
  }
  const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (meta.name !== name) {
    const e = new Error(`book.json name mismatch: ${meta.name} != ${name}`);
    e.status = 500;
    throw e;
  }
  if (!Array.isArray(meta.chapters)) {
    const e = new Error(`book.json chapters must be an array`);
    e.status = 500;
    throw e;
  }
  return meta;
}

// 只允許同目錄 .md，擋 ../ 跳脫
function resolveChapterFile(dir, ch) {
  let file = ch.endsWith('.md') ? ch : `${ch}.md`;
  if (file.includes('/') || file.includes('\\') || !file.endsWith('.md')) {
    const e = new Error(`invalid chapter: ${ch}`);
    e.status = 400;
    throw e;
  }
  const full = path.normalize(path.join(dir, file));
  if (!full.startsWith(path.normalize(dir + path.sep))) {
    const e = new Error(`invalid chapter: ${ch}`);
    e.status = 400;
    throw e;
  }
  if (!fs.existsSync(full)) {
    const e = new Error(`chapter not found: ${ch}`);
    e.status = 404;
    throw e;
  }
  return full;
}

function chapterTitle(markdown, fallback) {
  const m = markdown.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

// 解析 info string：`bash #step cwd:foo expect:bar`
function parseInfo(info) {
  const tokens = info.trim().split(/\s+/).filter(Boolean);
  const lang = (tokens.shift() || '').toLowerCase();
  let mode = null;
  let cwd = null;
  let expect = null;
  for (const t of tokens) {
    if (t === '#run') mode = mode || 'run';
    else if (t === '#step') mode = 'step';
    else if (t.startsWith('cwd:')) cwd = t.slice(4) || null;
    else if (t.startsWith('expect:')) expect = t.slice(7) || null;
  }
  return { lang, mode, cwd, expect };
}

// 抽出 runnable blocks；id = `${base}-${n}`
function parseBlocks(markdown, base) {
  const blocks = [];
  const re = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let m;
  let n = 0;
  while ((m = re.exec(markdown)) !== null) {
    const { lang, mode, cwd, expect } = parseInfo(m[1] || '');
    if (!mode) continue; // 無標籤 → 純展示
    const code = m[2].replace(/\s+$/, '');
    if (!code.trim()) continue; // 空 block → 略過
    n += 1;
    blocks.push({ id: `${base}-${n}`, lang, code, mode, cwd, expect });
  }
  return blocks;
}

function listBooks() {
  if (!fs.existsSync(BOOKS_DIR)) return [];
  return fs
    .readdirSync(BOOKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && NAME_RE.test(d.name))
    .map((d) => {
      try {
        const meta = readBookMeta(d.name);
        return { name: meta.name, title: meta.title, version: meta.version };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getBook(name) {
  const meta = readBookMeta(name);
  const dir = bookPath(name);
  const chapters = meta.chapters.map((f) => {
    const full = resolveChapterFile(dir, f);
    const md = fs.readFileSync(full, 'utf8');
    return { file: path.basename(full), title: chapterTitle(md, path.basename(full, '.md')) };
  });
  return { name: meta.name, title: meta.title, version: meta.version, defaultCwd: meta.defaultCwd || null, chapters };
}

function getChapter(name, ch) {
  const meta = readBookMeta(name);
  const dir = bookPath(name);
  const full = resolveChapterFile(dir, ch);
  const markdown = fs.readFileSync(full, 'utf8');
  const base = path.basename(full, '.md');
  return {
    file: path.basename(full),
    title: chapterTitle(markdown, base),
    markdown,
    blocks: parseBlocks(markdown, base),
  };
}

module.exports = { booksDir, listBooks, getBook, getChapter, parseBlocks, parseInfo, chapterTitle, RUN_LANGS };
