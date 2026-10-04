// shellbook v0.3 — splitSteps 單元測試（不需起 server）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitSteps } = require('../src/steps');

test('基本：逐行切分，空行略過', () => {
  assert.deepEqual(splitSteps('echo a\necho b\n'), ['echo a', 'echo b']);
  assert.deepEqual(splitSteps('\n\necho a\n\n\necho b\n\n'), ['echo a', 'echo b']);
});

test('續行：反斜線接成一步', () => {
  assert.deepEqual(splitSteps('echo a \\\n  b\necho c'), ['echo a \\\n  b', 'echo c']);
});

test('heredoc：整段成一步', () => {
  const code = 'cat <<EOF\nhello\nEOF\necho done';
  assert.deepEqual(splitSteps(code), ['cat <<EOF\nhello\nEOF', 'echo done']);
});

test('heredoc：<<- 與引號形式', () => {
  assert.deepEqual(splitSteps('cat <<-EOS\nx\nEOS\necho ok'), ['cat <<-EOS\nx\nEOS', 'echo ok']);
  assert.deepEqual(splitSteps("cat <<'EOF'\nx\nEOF"), ["cat <<'EOF'\nx\nEOF"]);
});

test('註解行保留，空白程式 pile 回傳空陣列', () => {
  assert.deepEqual(splitSteps('# just a comment\necho hi'), ['# just a comment', 'echo hi']);
  assert.deepEqual(splitSteps('   \n\n  '), []);
});

test('未閉合 heredoc 不炸，剩餘全收成一步', () => {
  assert.deepEqual(splitSteps('cat <<EOF\nhi'), ['cat <<EOF\nhi']);
});

test('compound：if/else/fi 接成一步', () => {
  const code = 'if true; then\necho THEN\nelse\necho ELSE\nfi\necho after';
  assert.deepEqual(splitSteps(code), ['if true; then\necho THEN\nelse\necho ELSE\nfi', 'echo after']);
});

test('compound：單行 if 不影響', () => {
  assert.deepEqual(splitSteps('if true; then echo T; fi\necho next'), ['if true; then echo T; fi', 'echo next']);
});

test('compound：for/done 與巢狀', () => {
  const code = 'for i in 1 2; do\nif [ "$i" = 1 ]; then\necho one\nfi\ndone';
  assert.deepEqual(splitSteps(code), [code]);
});

test('compound：引號與註解內的關鍵字不算', () => {
  assert.deepEqual(splitSteps('echo "if you like"\necho ok'), ['echo "if you like"', 'echo ok']);
  assert.deepEqual(splitSteps('echo hi # fi done\nfoo'), ['echo hi # fi done', 'foo']);
});

test('compound：case/esac 與大括號群組', () => {
  assert.deepEqual(splitSteps('case $x in\na) echo A;;\nesac'), ['case $x in\na) echo A;;\nesac']);
  assert.deepEqual(splitSteps('{\necho a\necho b\n}'), ['{\necho a\necho b\n}']);
});
