// shellbook v0.3–v0.7 — 把 code block 切成「邏輯行」（steps）
// 規則：
// - 空行略過；純註解行保留（送去 shell 無害，學員看得見）
// - `\` 續行接成一步
// - heredoc（<<EOF / <<-EOF / 引號形式）整段接成一步，直到結束符單獨成行
// - compound block（v0.7＋）：if/for/while/until/case/select/{/（...）沒閉合前不切。
//   寧可多併（執行結果一樣），不可少併（少併會把 marker 吞進未閉合結構造成 hang）。
function splitSteps(code) {
  const rawLines = String(code).split('\n');
  const steps = [];
  let buf = null; // [{ text, scan }]，scan=false 者（heredoc 內文）不參與 compound 計算
  let heredoc = null;

  const depth = () => {
    let d = 0;
    for (const p of buf) {
      if (p.scan) d += unitDepth(p.text);
    }
    return d;
  };
  const joined = () => buf.map((p) => p.text).join('\n');
  const push = () => {
    steps.push(joined());
    buf = null;
  };

  for (const line of rawLines) {
    if (heredoc) {
      buf.push({ text: line, scan: false });
      if (line.trim() === heredoc) {
        heredoc = null;
        if (!/\\\s*$/.test(joined()) && depth() <= 0) push();
      }
      continue;
    }
    if (buf !== null) {
      buf.push({ text: line, scan: true });
    } else {
      if (!line.trim()) continue; // 空行略過
      buf = [{ text: line, scan: true }];
    }
    // heredoc 只在一步的第一行偵測（續行中不重判）
    if (buf.length === 1) {
      const hm = line.match(/<<-?\s*['"]?([A-Za-z0-9_]+)['"]?/);
      if (hm) {
        heredoc = hm[1];
        continue;
      }
    }
    if (/\\\s*$/.test(joined())) continue; // `\` 續行
    if (depth() > 0) continue; // compound 未閉合
    push();
  }
  if (buf !== null) push();
  return steps.map((s) => s.replace(/\s+$/, '')).filter((s) => s.trim());
}

const OPEN = new Set(['if', 'for', 'while', 'until', 'case', 'select', '{', '(']);
const CLOSE = new Set(['fi', 'done', 'esac', '}', ')']);

// 單行（不含 heredoc 內文）的 compound 深度變化；引號內與註解不算
function unitDepth(text) {
  let d = 0;
  for (const tok of shellTokens(stripLineComment(text))) {
    if (OPEN.has(tok)) d++;
    else if (CLOSE.has(tok)) d--;
  }
  return d;
}

function stripLineComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function shellTokens(line) {
  const tokens = [];
  let cur = '';
  let q = null;
  for (const c of line) {
    if (q) {
      cur += c;
      if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (/\s/.test(c) || c === ';') {
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

module.exports = { splitSteps };
