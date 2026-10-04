// shellbook v0.5 — 危險指令判定（deny-list）
// 用途：run/step 整塊預檢（嚴格）＋手打逐行守衛（best-effort）。
// 原則：寧擋錯不放過系統級破壞；沙盒內相對路徑一律放行（書要用）。
const DANGEROUS_TARGETS = new Set([
  '/', '/*', '/.', '~', '$HOME', '${HOME}',
  '/bin', '/sbin', '/etc', '/usr', '/var', '/dev', '/opt',
  '/System', '/Applications', '/Library', '/private',
  '*', '.', '..',
]);
// 系統目錄底下的任何路徑也一樣危險
const DANGEROUS_PREFIXES = [
  '/bin/', '/sbin/', '/etc/', '/usr/', '/var/', '/dev/', '/opt/',
  '/System/', '/Applications/', '/Library/', '/private/',
  '~/', '$HOME/', '${HOME}/',
];

function isDangerousTarget(t) {
  if (DANGEROUS_TARGETS.has(t)) return true;
  const norm = t.replace(/\/+$/, '') || '/';
  if (DANGEROUS_TARGETS.has(norm)) return true;
  return DANGEROUS_PREFIXES.some((p) => t.startsWith(p) || norm.startsWith(p));
}

// quote-aware 切 token（引號內容整塊保留，前後含引號）
function tokenize(line) {
  const tokens = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (/\s/.test(c)) {
      if (cur) {
        tokens.push(cur);
        cur = '';
      }
    } else {
      cur += c;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

const unquote = (t) => {
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
    return t.slice(1, -1);
  }
  return t;
};

function checkRm(tokens) {
  // 找 rm（跳過前導 VAR=x 與 sudo）
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || tokens[i] === 'sudo' || tokens[i] === 'env')) i++;
  if (tokens[i] !== 'rm') return null;
  const flags = new Set();
  const targets = [];
  for (let j = i + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.startsWith('-') && t.length > 1 && !t.startsWith('--')) {
      for (const f of t.slice(1)) flags.add(f);
    } else if (t === '--no-preserve-root') {
      return 'rm --no-preserve-root（保護 root 的開關被關掉）';
    } else if (t.startsWith('--')) {
      continue; // --one-file-system 等相對無害的 flag
    } else if (t === '-') {
      continue;
    } else {
      targets.push(unquote(t));
    }
  }
  if (!flags.has('r') && !flags.has('R')) return null; // 非遞迴刪除：交給一般規則
  for (const t of targets) {
    if (isDangerousTarget(t)) return `rm -r 目標太危險：${t}`;
  }
  return null;
}

const RULES = [
  { re: /:\(\)\s*\{/, reason: 'fork bomb' },
  { re: /\bmkfs(\.\w+)?\b/, reason: 'mkfs（格式化磁碟）' },
  { re: /\bdd\b.*\bof=\/dev\//, reason: 'dd 寫入裝置' },
  { re: /\b(shutdown|reboot|poweroff|halt)\b/, reason: '關機/重開機指令' },
  { re: /(^|[;|&\s])init\s+[06]\b/, reason: 'init 0/6（關機/重開）' },
  { re: />\s*\/dev\/(sd[a-z]|hd[a-z]|nvme|mmcblk|disk|mem|kmem)/, reason: '重定向寫入硬體裝置' },
  { re: /\b(fdisk|parted|mkswap|swapoff|swapon)\b.*\/dev\//, reason: '磁碟分割/swap 操作' },
  { re: /\b(chmod|chown)\b[^|;]*-[a-zA-Z]*R[^|;]*\s\/(\s|$)/, reason: '遞迴改系統根目錄權限' },
];

function stripLeadingEnv(line) {
  // 去掉前導 VAR=x（sudo 保留給規則看，但 rm 檢查會自己跳過）
  return line.replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*=[^\s]*)+/, '');
}

// 去掉註解（# 開頭或空白+#；引號內的 # 不算——簡化：先去引號段再找）
function stripComment(line) {
  const noStr = line.replace(/"([^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''");
  const m = noStr.match(/(^|\s)#/);
  return m ? line.slice(0, m.index === 0 ? 0 : m.index + m[1].length) : line;
}

function isDenied(rawLine) {
  const line = stripComment(String(rawLine)).trim();
  if (!line) return { denied: false };
  // $() 與 `` 內的指令也會執行：遞迴檢查
  for (const inner of substitutions(line)) {
    const hit = isDenied(inner);
    if (hit.denied) return hit;
  }
  // && || ; | & 串起的每一段都會執行：逐段檢查
  // （RULES 看「去引號段」：引號包起來的只是字串，如 echo 'shutdown'；
  //  裸詞則擋——寧嚴勿鬆；rm 另有 quote-aware 的專門檢查，不受影響）
  for (const seg of segments(line)) {
    const rmHit = checkRm(tokenize(stripLeadingEnv(seg)));
    if (rmHit) return { denied: true, reason: rmHit };
    const noStr = stripLeadingEnv(seg)
      .replace(/"([^"\\]|\\.)*"/g, '')
      .replace(/'[^']*'/g, '')
      .replace(/^(sudo\s+)+/, '');
    for (const { re, reason } of RULES) {
      if (re.test(noStr)) return { denied: true, reason };
    }
  }
  return { denied: false };
}

// 前端「危險二次確認」用（子字串比對，寧可多問）
const WARN_SUBSTRINGS = [
  'rm -rf', 'rm -r', 'mkfs', ' dd ', 'shutdown', 'reboot',
  'chmod -R', 'chown -R', ':(){', 'curl', 'wget', '> /dev/',
  '--no-preserve-root',
];

// 以 && || ; | &（引號外）切段；每段都會被 shell 執行
function segments(line) {
  const segs = [];
  let cur = '';
  let q = null;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (q) {
      cur += c;
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      i++;
      continue;
    }
    if ((c === '&' && line[i + 1] === '&') || (c === '|' && line[i + 1] === '|')) {
      segs.push(cur);
      cur = '';
      i += 2;
      continue;
    }
    if (c === ';' || c === '|' || c === '&' || c === '\n') {
      segs.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  segs.push(cur);
  return segs;
}

// $() 與 `` 內容物也會被執行：抽出來遞迴檢查
function substitutions(line) {
  const out = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '$' && line[i + 1] === '(') {
      let depth = 0;
      let j = i + 1;
      let q = null;
      for (; j < line.length; j++) {
        const c = line[j];
        if (q) {
          if (c === q) q = null;
          continue;
        }
        if (c === '"' || c === "'") {
          q = c;
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (depth === 0 && j < line.length) {
        out.push(line.slice(i + 2, j));
        i = j;
      }
    } else if (line[i] === '`') {
      const j = line.indexOf('`', i + 1);
      if (j > 0) {
        out.push(line.slice(i + 1, j));
        i = j;
      }
    }
  }
  return out;
}

module.exports = { isDenied, WARN_SUBSTRINGS, tokenize };
