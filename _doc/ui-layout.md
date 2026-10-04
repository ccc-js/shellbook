# shellbook 主介面佈局 v0.1

## 三區

1. 功能表（menu）：1 row — 選擇載入的書籍 + 章節 + 全域操作
2. book 區：佔所有剩餘 rows — HTML 互動書籍（Markdown 渲染，可點範例）
3. shell 區：固定 20 rows — xterm，可手打，也可由書上範例驅動（單步 / 整塊執行）

## 版面圖

```
┌─────────────────────────────────────────┐
│ 功能表 1 row: [書籍▾][章節▾][重連][狀態] │  height: 1 row (~32-40px)
├─────────────────────────────────────────┤
│                                         │
│  book 區 (flex:1, overflow:auto)        │  剩餘高度（可拉動）
│  - 章節內文 HTML                        │
│  - code block 右上: [單步][全跑][複製]  │
│                                         │
╞═════════════════════════════════════════╡  分隔條 splitter（高 6px，可上下拖曳）
├─────────────────────────────────────────┤
│ shell 區 預設 20 rows                   │  預設 20 * line-height (~360px)
│ $ _                                     │  拖曳後 5 rows ~ 全高-保留 book 120px │
└─────────────────────────────────────────┘
```

- 全頁 `height: 100vh; display:flex; flex-direction:column; overflow:hidden`
- 只有 book 區與 shell 區內部可捲，整頁不捲。
- shell 預設 20 rows：`shellHeight = 20 * charHeight`（xterm 量測值），CSS 預設約 `360px`。
- 中間分隔條可拉動：book 與 shell 高度互補（menu 高度固定，總和 = 視窗高 - menu - splitter）。
  - 拖曳範圍：shell 最小 5 rows（約 90px，僅留 shell-bar + 2 行），最大到只留 book 120px。
  - 放開即生效，xterm 觸發 `fit()` + 送 `resize` 給後端 pty；book 捲軸位置保持不動。
  - 雙擊分隔條：回到預設 20 rows。
  - 記憶：`localStorage.shellbook.shellHeight` 存 px，下次開啟還原。

## 各區規格

### 1. 功能表（1 row）

- 內容：`logo shellbook | 書籍 select | 章節 select | [重連] [中斷] | cwd 顯示 | 連線燈`
- 高度固定，不換行；窄螢幕時章節 select 縮寬。
- 行為：
  - 切書 → `GET /api/books/:name` 重載 book 區，shell 不清空（保留歷史），只提示 `cd workspace/sessions/<id>/<book>`。
  - 斷線時連線燈紅 + `[重連]` 閃。

### 2. book 區（剩餘全部）

- Markdown → HTML（marked + highlight），每個 runnable block 結構：
  ```html
  <div class="codeblock" data-block-id="ch2-03" data-mode="step">
    <div class="cb-bar"><span>sh · 5 行</span><button>單步</button><button>全跑</button><button>複製</button></div>
    <pre><code>...</code></pre>
    <div class="cb-progress">第 2/5 行 ✓✓·</div>
  </div>
  ```
- 執行中：當前行高亮，book 區不跳動（只 shell 區自動捲）。
- 非 runnable code（無 `#run`/`#step` 標籤）：不顯示按鈕。

### 3. shell 區（20 rows）

- xterm.js 全填滿，支援手打 + 貼上。
- 兩種被驅動模式：
  - 全跑：一次送整塊 code，逐行 echo `$ <cmd>` 再顯示輸出。
  - 單步：第一次點在 block 旁建 step 指標，每按一次送一行，高亮同步到 book 區。
- 頂部薄 bar：`[shell: bash][cwd:...][清空][中斷 Ctrl+C]`，此 bar 計入 20 rows 之內（xterm 實得 ~18 rows，可接受；或 bar 浮疊不佔位）。
- 手打與範例共用同一 pty queue，執行中按鈕 disabled，避免交錯。

## HTML/CSS 骨架

```html
<body>
  <header id="menu">…1 row…</header>
  <main id="book">…章節 HTML…</main>
  <div id="splitter" title="拖曳調整 book/shell 高度（雙擊回 20 rows）"></div>
  <footer id="shell-pane">
    <div id="shell-bar">…</div>
    <div id="terminal"></div>
  </footer>
</body>
```

```css
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;height:100vh;overflow:hidden}
#menu{flex:0 0 36px;display:flex;align-items:center;gap:8px}
#book{flex:1 1 auto;overflow:auto;padding:16px 24px;min-height:120px}
#splitter{flex:0 0 6px;cursor:row-resize;background:#2a2a2a}
#splitter:hover,#splitter.dragging{background:#4a90e2}
#shell-pane{flex:0 0 360px;display:flex;flex-direction:column;border-top:none;min-height:90px}
#terminal{flex:1;overflow:hidden;background:#000}
```

```js
// 拖曳邏輯（要點，只有 mousedown/move/up）
const splitter = document.getElementById('splitter');
const shellPane = document.getElementById('shell-pane');
splitter.addEventListener('mousedown', e => {
  const startY = e.clientY, startH = shellPane.offsetHeight;
  splitter.classList.add('dragging');
  const move = ev => {
    const dh = startY - ev.clientY; // 往上拉 = shell 變高
    const maxH = window.innerHeight - 36 - 6 - 120; // menu+splitter+book最小
    const h = Math.min(Math.max(startH + dh, 90), maxH);
    shellPane.style.flexBasis = h + 'px';
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    splitter.classList.remove('dragging');
    term.fit(); ws.send(JSON.stringify({type:'resize', cols:term.cols, rows:term.rows}));
    localStorage.setItem('shellbook.shellHeight', shellPane.offsetHeight);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
});
splitter.addEventListener('dblclick', () => {
  shellPane.style.flexBasis = '360px'; // 回預設 20 rows
  term.fit(); // + resize + 存 localStorage 同上
});
```

## websocket 訊息（配合此佈局，最小集）

- `input`：手打字串；`run`：整塊執行；`runLine`：單步一行；`interrupt`：Ctrl+C；`resize`
- 後端回 `output` / `result{exitCode}` / `state{running, cwd}`（cwd 顯示在 menu + shell-bar）

## 驗收

- [ ] 視窗任意高度下，menu 1 row 不被擠掉，shell 預設約 20 rows，book 吃掉中間。
- [ ] 按住中間分隔條上下拖：book 變矮 ↔ shell 變高（反之亦然），放開後 xterm 自動 fit 且後端 pty cols/rows 同步。
- [ ] 極端值：shell 最小 ~5 rows、最大到 book 剩 120px，不會把任一區拖到消失。
- [ ] 雙擊分隔條回到預設 20 rows；重整頁面後高度還原（localStorage）。
- [ ] 書上點「全跑」→ shell 出現指令與輸出；點「單步」→ 一次一行。
- [ ] shell 可手打 `echo hi` 正常；執行中切書不當機。
