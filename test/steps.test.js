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
