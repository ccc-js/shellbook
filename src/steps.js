// shellbook v0.3 — 把 code block 切成「邏輯行」（steps）
// 規則：
// - 空行略過；純註解行保留（送去 shell 無害，學員看得見）
// - `\` 續行接成一步
// - heredoc（<<EOF / <<-EOF / 引號形式）整段接成一步，直到結束符單獨成行
function splitSteps(code) {
  const rawLines = String(code).split('\n');
  const steps = [];
  let buf = null;
  let heredoc = null;

  for (const line of rawLines) {
    if (heredoc) {
      buf += '\n' + line;
      if (line.trim() === heredoc) {
        steps.push(buf);
        buf = null;
        heredoc = null;
      }
      continue;
    }
    if (buf !== null) {
      buf += '\n' + line;
    } else {
      if (!line.trim()) continue; // 空行略過
      buf = line;
    }
    // heredoc 只在一步的第一行偵測（續行中不重判）
    if (!buf.includes('\n')) {
      const hm = line.match(/<<-?\s*['"]?([A-Za-z0-9_]+)['"]?/);
      if (hm) {
        heredoc = hm[1];
        continue;
      }
    }
    if (/\\\s*$/.test(buf)) continue; // `\` 續行
    steps.push(buf);
    buf = null;
  }
  if (buf !== null) steps.push(buf);
  return steps;
}

module.exports = { splitSteps };
