# 第三章：Node 骨架＋測試

不用 `npm install`（零依賴、最快）：手寫 `package.json`、
一個 `sum` 函式、一個測試，然後 `npm test` 變綠。
用 opencode 輔助寫碼時，也是先讓測試變綠再說。

## 範例 1：寫骨架（三段 heredoc）

```sh #run expect:sum
R="$SHELLBOOK_WS/demo-proj"
cat > "$R/package.json" <<EOF
{
  "name": "demo-proj",
  "version": "0.1.0",
  "scripts": { "test": "node --test test/*.test.js" }
}
EOF
mkdir -p "$R/test"
cat > "$R/sum.js" <<EOF
function sum(a, b) { return a + b; }
module.exports = { sum };
EOF
cat > "$R/test/sum.test.js" <<EOF
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sum } = require('../sum');
test('sum', () => assert.equal(sum(2, 3), 5));
EOF
ls "$R"
```

## 範例 2：跑測試（要綠）

```bash #run expect:pass
cd "$SHELLBOOK_WS/demo-proj" && npm test
```

## 範例 3：忽略檔＋commit

```bash #run expect:node
R="$SHELLBOOK_WS/demo-proj"
printf 'node_modules/\n' > "$R/.gitignore"
git -C "$R" add package.json sum.js test .gitignore
git -C "$R" commit -m "feat(node): sum with test"
git -C "$R" status --short
```
