# shellbook 規劃 plan0.x — v0.1 ~ v1.0

> 願景：結合 Book + Shell 的 Node.js 學習平台。載入一本書 → 照書操作 → 點擊範例 → 經 websocket 在後端 shell 逐步執行（單步 / 一次全跑），在 terminal 觀察輸出學會技能，最終建出完整專案。

- 技術棧（暫定）：Node.js 20+ / Express (or Fastify) / `ws` / `node-pty` / 前端 `xterm.js` + `marked` / Markdown book 格式
- 執行原則：每個版本都是可跑、可驗收的增量；先 shell 通道，再 book 渲染，再兩者連結，再安全與體驗。
- 書籍範例：`gitbook/`（教 git）、`fullstack-book/`（git+github+opencode+rust+node.js+docker+github action 建專案學軟體工程）

---

## 總覽路線圖

| 版本 | 主題 | 關鍵交付 |
|------|------|----------|
| v0.1 | Shell 通道 MVP | 後端 pty + websocket echo + 前端 xterm 可打字執行 |
| v0.2 | Book 載入與渲染 | book/ 目錄規範 + Markdown 渲染 + code block 列表 |
| v0.3 | Book ↔ Shell 連動 | 點選執行 / 單步 / 全跑 / 輸出對照 |
| v0.4 | 範例書籍 | gitbook + fullstack-book 可完整跑完 |
| v0.5 | 安全與多 session | 隔離、allowlist、session 管理、資源限制 |
| v0.6 | 學習體驗 | 進度追蹤、notebook 紀錄、UX 打磨 |
| v1.0 | 發布 | CLI、Docker、CI、文件、安裝一鍵跑 |

---

## v0.1 — Shell 通道 MVP

目標：證明 websocket → 後端 shell → 前端 terminal 迴路可通。

- 後端：
  - `server.js` (Express static + `ws` attach)
  - `POST /api/health` 健康檢查
  - `WS /ws/shell` ：前端送 `{type:"input", data:"ls\n"}`，後端經 `node-pty` 回 `{type:"output", data:"..."}`，支援 resize、心跳、結束重建
  - 單一全域 pty（先不做多 session），cwd 預設為 `workspace/`
  - 結束碼、stderr 合併輸出，最簡 log
- 前端：
  - `public/index.html` + `xterm.js`（CDN 先可，後續 npm bundle）
  - 可打字、可貼上、可看到輸出；斷線顯示 + 重連按鈕
- 驗收：
  - `npm install && npm start` 後開 `http://localhost:3000`，打 `echo hello && pwd && ls` 看到正確輸出
  - 殺掉後端再重啟，前端按重連可恢復
  - 長輸出（`seq 1 1000`）、Ctrl+C 中斷正常
- 測試：手動為主 + `health` smoke test
- 產出結構：
  ```
  package.json server.js public/index.html workspace/ _doc/plan0.x.md
  ```

## v0.2 — Book 載入與渲染（還不執行）

目標：定義書的格式，前端能看書、能列出可執行範例。

- Book 規範 `BOOK.md`（初版）：
  ```
  book/
    book.json  {title, version, cwd, chapters:[...]}
    ch01-xxx.md
    ...
  ```
  - markdown 中 fenced code block 加註 ` ```sh #run ` / ` ```bash #step ` 即視為可執行範例；可加 `cwd:`、`expect:` 註記（先解析，執行留到 v0.3）
  - `book.json` 含 `name,title,version,defaultCwd,allowCommands?`
- 後端：
  - `GET /api/books` 列出 `books/*`
  - `GET /api/books/:name` 回 book.json + 章節列表
  - `GET /api/books/:name/ch/:ch` 回 markdown 原文 + 解析出的 blocks `[{id, lang, code, mode}]`
  - 先用 `marked` 前端渲染即可，後端只做解析（正則抽 code fence）
- 前端：
  - 左欄：書籍/章節選單；中欄：書內容渲染 + 每個 runnable block 右上角 `▶ 插入` 按鈕（v0.2 只做「插入到 terminal」，不自動執行）
  - 右欄（或下方）：xterm（沿用 v0.1）
- 驗收：
  - 放一本 `books/demo/` 兩章三個 block，前端能切章、能看到按鈕、按了字串出現在 terminal input（使用者按 Enter 才跑）
- 測試：book parser 單元測試（3~5 個 md 邊界：無標籤不抓、混合語言、空 block）

## v0.3 — Book ↔ Shell 連動（核心價值）

目標：本版是 shellbook 的「啊哈時刻」：點書即跑 shell，可單步可全跑。

- 後端：
  - `POST /ws/shell` 擴充訊息：`{type:"run", blockId, code}` 與 `{type:"runLines", lines:[...] }`
  - 支援 `step` 模式：後端把 block 按行拆（處理 `\` 續行、`<<EOF` heredoc 簡易版），前端 `下一步` 一次送一行
  - 每步回傳 `{type:"result", exitCode, durationMs}`（用 shell `echo __SB_EXIT:$?` 技巧或 pty 標記，先求有）
  - 簡易 queue：執行中禁用重複送，避免交錯
- 前端：
  - block 升級為三鈕：`單步 ▶|`, `全跑 ▶▶`, `複製`
  - 執行時該 block 高亮「執行中行」；輸出區自動捲到最新；顯示每行 `$ cmd` + 輸出 + exit code
  - 失敗即停 + 紅字提示（全跑模式）
- 驗收：
  - demo 書一章 5 行範例：全跑一次過；單步按 5 次逐行出現正確輸出；中間一行 `exit 1` 會停並提示
- 測試：step splitter 單元測試 + 手動 E2E 腳本

## v0.4 — 範例書籍：gitbook + fullstack-book

目標：用真實書驗證 v0.3 設計，不好用的地方回頭修。

- `books/gitbook/`：
  - ch01 安裝檢查、ch02 init/add/commit/log/status、ch03 branch/merge/conflict 演練、ch04 remote/clone/push（用本地 bare repo 模擬，不依賴真 GitHub）
  - 每步有 `expect:`（例如 `git status` 要看到什麼關鍵字），前端顯示「預期觀察點」
- `books/fullstack-book/`（亦可先叫 `se-book/`）：
  - 串起 git+github+opencode+rust+node.js+docker+github action 建專案骨架（每章只做可自動驗證的子集，GitHub 章用 `gh --version` / dry-run，不真發 PR）
  - 跑完後 `workspace/demo-proj/` 存在且 `npm test` / `cargo test` / `docker build` 其中至少一項能過（依環境降級）
- 驗收：
  - 新手照書點完全跑，gitbook 全綠；fullstack-book 在 CI 或乾淨容器內全綠
  - 書中每個 block 都有人實際點過，無「貼上就錯」範例
- 附帶：把 v0.3 難用處修掉（續行、heredoc、互動指令 `vim/git log` 的提示與禁用清單初版）

## v0.5 — 安全與多 session

目標：敢給別人用、不怕一本書毀掉整台電腦。

- 後端：
  - 每個 browser tab 一個獨立 pty session (`sessionId`)，`workspace/sessions/<id>/` 為 cwd 沙盒
  - `config/shellbook.json`：`allowCommands` / `denyCommands`（預設擋 `rm -rf /`, `mkfs`, `shutdown` 等）、`maxOutput`, `timeoutMs`, `maxSessions`
  - 超時 kill、輸出截斷、session 閒置回收（例如 30 min）
  - 最簡 audit log：`logs/<session>.log` 記下誰跑了什麼、何時、exit code
- 前端：
  - session 選單：新增 / 切換 / 刪除；顯示 cwd；危險指令跑前二次確認
- 驗收：
  - 開兩 tab 互不干擾；`rm -rf /` 被擋並提示；大輸出不卡死前端；閒置 session 被回收
- 測試：deny-list 單元測試 + 雙 session 手動測試 + 高壓輸出測試

## v0.6 — 學習體驗：進度、紀錄、打磨

目標：從「能跑」變「好學」。

- 進度追蹤：`localStorage` + 後端 `progress.json` 記每 block `done/failed/skipped`，章節顯示 ✓ 進度條，重進還在
- 學習紀錄：一鍵匯出 session log + 執行的書頁為 `notes/<date>.md`；支援「重跑本章」「重置本書進度」
- UX：markdown code 高亮、行號、預期輸出對照（expect 關鍵字自動打勾）、錯誤輸出友善提示（常見 git 錯誤給連結/解法一句話）
- 快捷鍵：`Cmd/Ctrl+Enter` 全跑、`Shift+Enter` 單步
- 驗收：中斷後重開瀏覽器進度還在；匯出筆記含完整指令與輸出

## v1.0 — 發布：CLI、Docker、CI、文件

目標：別人 `git clone` 下來 5 分鐘能跑起來學。

- CLI：`npx shellbook ./books/gitbook --port 3000 --open`
- Docker：`Dockerfile` + `docker compose up` 一鍵（含 rust/node/docker-outside 教學所需的最小工具，或文件註明哪些章需本機 docker）
- CI：GitHub Action 跑 parser 單元測試 + gitbook 自動化 E2E（headless 跑完全書不斷言失敗）
- 文件：`README.md` 重寫（安裝/載書/寫書三段式）、`_doc/BOOK.md` 書籍作者規格定稿、`_doc/API.md` websocket+REST 定稿
- 版本化：`CHANGELOG.md` + `npm version` 流程；v1.0 tag
- 驗收：在乾淨 VM/容器照 README 從零跑到 gitbook 結業

---

## 非目標（v1.0 以前不做）

- 多人帳號/權限、雲端同步進度
- 完整沙盒虛擬化（先用 cwd + deny-list，不做 gVisor/Firecracker）
- Windows 原生 pty 完整支援（先 Mac/Linux，Windows 走 WSL/容器）
- AI 自動解題/閱卷（expect 只做關鍵字包含，不做語義評分）

## 風險與對策

1. `node-pty` 原生編譯失敗 → 鎖版本、提供 `Dockerfile` 預建映像、文件寫 troubleshooting
2. 互動指令（vim/less/git pager）卡住 → education 書避開 pager（`--no-pager`），前端加「中斷」鈕 + 文件列黑名單
3. Heredoc/續行拆行錯誤 → splitter 保守策略：不確定就整塊全跑，並在書規範註明寫法限制
4. 全跑破壞使用者環境 → v0.5 前所有書預設跑在 `workspace/` 沙盒，並在 UI 常駐顯示 cwd

## 建議目錄（演進到 v1.0）

```
server.js (或 src/server.js)
src/pty.js src/books.js src/steps.js src/config.js src/logger.js
public/index.html public/app.js public/style.css
books/gitbook/ books/fullstack-book/ books/demo/
workspace/ config/shellbook.json
test/parser.test.js test/steps.test.js
_doc/plan0.x.md _doc/BOOK.md _doc/API.md
Dockerfile docker-compose.yml .github/workflows/ci.yml
```

## 下一步（做 v0.1 前）

- [ ] `npm init -y`，裝 `express ws node-pty`，定 Node 版本（`.nvmrc`）
- [ ] 照 v0.1 驗收寫最小 server + xterm 頁，先讓 `echo hello` 通
