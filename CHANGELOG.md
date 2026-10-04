# CHANGELOG

格式跟著 Keep a Changelog 的精神：每個版本寫「為什麼＋改了什麼」。
版號：`0.x` 開發期，`1.0.0` 首個可發布版。

## [1.0.0] — 首個可發布版

- v0.8（安全預設 localhost、CLI、Dockerfile/compose、版號修正、marker 鹽）＋
  v0.9（README、API.md、CHANGELOG、CI、手動驗收清單、手機版）收尾。
- 驗證：`npm test` 131/131 綠；乾淨容器（`docker build`＋`docker run`＋
  `docker compose up）照 README 從零跑到 gitbook 範例全綠；全工具鏈
  （git/node/cargo/gh/docker client）在映像內就緒。
- 版號 1.0.0；`main` 指 server.js；`engines: node>=20`。

## [0.8.0] — 發布骨架與安全預設

- 預設只綁 `127.0.0.1`（`config.host`＋`SHELLBOOK_HOST`＋CLI `--host` 可改）。
- 新增 CLI：`bin/shellbook.js`（`[book]`＋`--port/--host/--books-dir/--open`），
  `?book=` 開頁預選；`SHELLBOOK_BOOKS_DIR` 可指別處的書。
- 新增 `Dockerfile`（node＋git＋rust＋gh＋docker-cli）＋`compose.yml`
  （sock＋workspace 掛載）＋`.dockerignore`。
- `package.json`：版號 0.8.0、`main` 指回 server.js、加 `bin`／`files`／`engines>=20`。
- Runner marker 加隨機鹽（防範例輸出偽造結案）。

## [0.7.0] — fullstack-github：加上 GitHub 實戰

- 新書 `books/fullstack-github/`（9 章 23 範例）：授權＋建倉推送＋fork/PR＋Actions；
  mutating 指令 `if gh auth status` 包裝＋`GH_` 狀態 token（`_doc/BOOK.md` #10）。
- `splitSteps` compound 感知（if/for/while/until/case/`{}`/`()`）；
  runnable 塊內 `gh` 統一 `TERM=dumb` 前綴。

## [0.6.0] — 學習體驗

- `src/progress.js`＋進度 API（記／查／按章或整本重置）；章節進度條＋✓✗徽章＋重跑。
- expect 關鍵字自動對照（`{type:'expect',met}`）；筆記匯出（`POST /api/notes/export`）。
- 前端：code 行號＋註解色、`⌘/Ctrl+Enter` 全跑／`Shift+Enter` 單步、失敗一句話提示。
- 修：`result/stepResult` 補上 `output`（v0.3 遺留）。

## [0.5.0] — 安全與多 session

- `src/guard.js` deny-list（rm／mkfs／dd／關機／fork bomb／裝置重定向…，
  拆段＋遞迴查 `$()`）；run/step 原子預檢＋手打逐行守衛。
- 每 WS 一 session（獨立 pty＋`workspace/sessions/<id>/` 沙盒、`?session=` 重連、
  上限／閒置回收／`logs/` audit）；前端 session 選單＋危險二次確認。
- `config/shellbook.json`（全可被 `SHELLBOOK_*` 覆寫）。

## [0.4.0] — 範例書籍

- `books/gitbook/`（4 章 10 範例，hermetic、零網路）＋
  `books/fullstack-book/`（5 章 13 範例，產出含 node/rust/docker/CI 的 demo-proj）。
- pty 注入 `$SHELLBOOK_WS`＋`SHELLBOOK_TIMEOUT_MS`；`_doc/BOOK.md` 寫書注意 #1–#9。
- 修：`gh` pty hang（`TERM=dumb`）、`node --test test/` 尾斜線。

## [0.3.0] — 點書即跑

- `src/steps.js` 切邏輯行＋`src/runner.js`（marker exit code、FIFO、失敗即停、
  單步游標、超時、中斷）；`run/step/reset` 訊息；前端三鈕＋高亮＋進度。

## [0.2.0] — Book 載入與渲染

- `_doc/BOOK.md` 書籍規範＋`src/books.js`＋`books/demo/`＋3 支唯讀 API；
  前端書籍選單＋marked 渲染＋「插入↓」（刻意不自動執行）。

## [0.1.0] — Shell 通道 MVP

- `server.js`（Express＋`ws`＋單一全域 pty）＋三區佈局前端（xterm 本地化、
  shell 20 rows＋可拖曳分隔條）；修 `node-pty` spawn-helper 權限坑。
