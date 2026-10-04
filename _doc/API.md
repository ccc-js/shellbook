# shellbook API（v1.0 定稿）

Base：`http://<host>:<port>/`（預設 `127.0.0.1:3000`）。
錯誤一律 `{error: string}`＋對應 HTTP status。

## REST

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | `{ok, version, workspace, sessions}` |
| GET | `/api/config` | `{host, maxSessions, timeoutMs, maxOutputBytes, warn[]}`（warn 給前端二次確認用） |
| GET | `/api/books` | `[{name,title,version}]` |
| GET | `/api/books/:name` | `{name,title,version,defaultCwd,chapters:[{file,title}]}`（無書 404） |
| GET | `/api/books/:name/ch/:ch` | `{file,title,markdown,blocks:[{id,lang,code,mode,cwd,expect}]}`；`:ch` 可省略 `.md`；`../` 跳脫 400 |
| GET | `/api/sessions` | `[{id,createdAt,lastActive,clients}]` |
| DELETE | `/api/sessions/:id` | 刪 session（殺 pty＋清沙盒目錄）；無此 id 404 |
| GET | `/api/progress/:book` | `{book,blocks:{blockId:{status,exitCode,expectMet,runs,at}}}`，status 只有 `done/failed` |
| DELETE | `/api/progress/:book[?chapter=base]` | 清整本或單章進度 |
| GET | `/api/notes` | `[{file,size,mtime}]`（`notes/*.md`，新在前） |
| POST | `/api/notes/export` | body `{session}` → `{ok,file,markdown}`；session 格式錯 400、無 log 404 |

靜態：`/` 主介面；`/vendor/*`（xterm/marked 本地檔）。

## WebSocket `WS /ws/shell[?session=id]`

- 不帶 `?session=` → 建新 session；帶已存在的 id → 接回同一沙盒；
  滿 `maxSessions` 又是新 session → 先送 `{type:'error',error:'max-sessions',max}` 再關閉（1013）。
- 連上先收到 `{type:'session',id,cwd}`（cwd=`workspace/sessions/<id>/`）。

### 送出（client → server）

| type | 欄位 | 說明 |
|---|---|---|
| `input` | `data: string` | 手打字串（逐行過 deny-list，危險行吃掉＋`⛔` 警告） |
| `resize` | `cols,rows: int` | 同步 pty 大小 |
| `run` | `blockId,code[,book,ch]` | 全跑：逐行，失敗即停；帶 book/ch 會記進度＋對 expect |
| `step` | `blockId,code[,book,ch]` | 單步：調一次跑一行（同 ws＋同 block 續游標） |
| `reset` | `blockId?` | 清單步游標 |
| `ping` | — | 回 `pong` |

### 收到（server → client）

| type | 欄位 | 說明 |
|---|---|---|
| `output` | `data: string` | pty 原始輸出（含手打回顯；多人同 session 都會收到） |
| `state` | （v0.1 遺留，現以 `session` 為主） | — |
| `runStarted/stepStarted` | `blockId,total,lines[]` | 後端切好的 steps（續行/heredoc/if 已合併） |
| `result/stepResult` | `blockId,index,total,line,exitCode,timeout,durationMs,output[,done]` | 每行回報；output 單行上限 `maxOutputBytes` |
| `runDone` | `blockId,ok[,failedIndex,exitCode,timeout,error]` | 全跑結束；`error:'empty'/'blocked'` |
| `stepResult.done=true` | 同上＋done | 單步走完最後一行 |
| `blocked` | `blockId,index,reason,line` | 整塊原子阻擋（deny-list），後面接 `runDone/stepResult{error:'blocked'}` |
| `expect` | `blockId,keyword,met` | expect 關鍵字有無出現在本 block 輸出（僅帶 book/ch 且書上有 expect 才發） |
| `stepReset` | `blockId` | 游標已清 |
| `session-ended` | `reason` | session 被刪／閒置回收；隨後關閉連線，前端應開新 session |
| `error` | `error,max?` | 如 `max-sessions` |
| `pong` | — | 心跳回應 |

## 環境變數（覆寫 `config/shellbook.json`）

`PORT`、`SHELLBOOK_HOST`、`SHELLBOOK_BOOKS_DIR`、`SHELLBOOK_MAX_SESSIONS`、
`SHELLBOOK_IDLE_MS`、`SHELLBOOK_SWEEP_MS`、`SHELLBOOK_TIMEOUT_MS`、
`SHELLBOOK_MAX_OUTPUT`、`SHELLBOOK_PROGRESS_DIR`。

pty 內保證有：`$SHELLBOOK_WS`（本 session 沙盒）、`$SHELLBOOK_SESSION`（id）。
