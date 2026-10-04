# BOOK.md — shellbook 書籍規範（v0.2 初版）

書 = 一個目錄，放在 `books/<name>/`。

```
books/demo/
  book.json
  ch01-hello.md
  ch02-files.md
```

## book.json

```json
{
  "name": "demo",
  "title": "示範書",
  "version": "0.1.0",
  "defaultCwd": "workspace/",
  "chapters": ["ch01-hello.md", "ch02-files.md"]
}
```

- `name` 必須等於目錄名（僅允許 `[a-z0-9-]`）。
- `chapters` 為檔名陣列，順序即閱讀順序；只允許同目錄下 `.md` 檔（擋 `../` 跳脫）。
- 章標題：取該 md 第一個 `# ` 標題；若無，則用檔名。

## 可執行範例（runnable block）

Markdown fenced code block 的 info string 加標籤即為可執行：

    ```sh #run
    echo hello
    ```

    ```bash #step cwd:workspace/demo expect:hello
    echo step1
    echo hello
    ```

- 語言：`sh|bash|shell|zsh`（其他語言加標籤亦視為可執行，v0.2 不擋）。
- `info string` token 規則（空白分隔，第一個 token 為語言）：
  - `#run`：整塊一次執行（v0.3 實作，v0.2 僅「插入 terminal」）。
  - `#step`：可單步執行（v0.3 實作，v0.2 僅「插入 terminal」）；同時出現以 `#step` 為準。
  - `cwd:<path>`：該 block 建議工作目錄（相對書或 workspace，v0.2 只解析不強制）。
  - `expect:<keyword>`：學員應觀察到的關鍵字（v0.2 只顯示不自動判定）。
- 判定：
  - 無 `#run`/`#step` → 非 runnable，不列入 blocks（純展示）。
  - 空程式碼（只有空白）→ 不列入。
- block id：`<章檔名去副檔名>-<章內序號>`，序號自 1 起，如 `ch01-hello-1`。

## API（v0.2，唯讀）

- `GET /api/books` → `[{name,title,version}]`
- `GET /api/books/:name` → `{name,title,version,defaultCwd,chapters:[{file,title}]}`
- `GET /api/books/:name/ch/:ch}` → `{file,title,markdown,blocks:[{id,lang,code,mode,cwd,expect}]}`
  - `:ch` 可為 `ch01-hello` 或 `ch01-hello.md`。
  - 不存在的書/章 → 404 `{error}`；`../` 跳脫 → 400。

## v0.2 刻意不做的事

- 不自動執行（只有「插入 terminal」，按 Enter 才跑，安全第一）。
- `cwd:`/`expect:` 只解析呈現，不強制、不自動閱卷（v0.3+ 才用）。

## 寫書注意（v0.4 實戰心得，寫自 gitbook＋fullstack-book 的血淚）

1. **每塊都先 `cd` 回定點**：shell 是同一個 persistent pty，`cd` 會殘留。
   全跑預設失敗即停，但成功執行的 `cd` 也會殘留。範例首行固定
   `cd "$SHELLBOOK_WS"` 或 `R="$SHELLBOOK_WS/<dir>"` 配 `git -C`，
   讓每塊獨立於執行順序。`$SHELLBOOK_WS` 由後端注入（pty env）。
2. **禁 pager**：`git log`、`git branch` 等會開 pager 卡住（等輸入）。
   書裡一律 `git --no-pager log ...`，或用 `--oneline`＋行數限制。
3. **禁互動**：不用 `vim`、`read`、`git add -i`；編輯檔用
   `printf`／`cat heredoc`；需要確認的指令先保證非互動能跑完。
4. **hermetic 身份**：`git config user.*` 只設倉庫本地
   （`git -C <repo> config ...`），絕不碰 `--global`。
5. **預期失敗要 `|| true`**：故意演練失敗（如 merge conflict 那行）
   必須加 `|| true`，否則全跑模式停在那裡。旁邊用文字說明這是故意的。
6. **重跑冪等**：`mkdir` 用 `-p`；`rm -rf <沙盒內路徑>` 開頭清場；
   `remote add`／`branch` 先 `remove/-D ... 2>/dev/null || true`。
   範圍只能在 `$SHELLBOOK_WS` 內，絕對路徑禁止。
7. **慢指令留時間**：`cargo test` 首次編譯、`docker build` 首次 pull
   都可能超過 30 秒；後端 `SHELLBOOK_TIMEOUT_MS` 可調（預設 30000ms），
   書裡不用改，e2e/部署時調大即可。
8. **會查終端能力的程式**：如 `gh` 啟動會發 OSC 11 / DSR 查顏色游標，
   在無真終端回應的 pty（自動化測試、headless）會卡住等到超時。
   解法：`TERM=dumb gh --version`，或只用 `command -v gh` 確認安裝。
   同理：寫書時每個新工具先在測試環境真跑一次（v0.4 的 e2e 就是幹這個的）。
9. **node --test 別加尾斜線**：`node --test test/` 在 node 24 會被當成
   模組路徑而報錯，要寫 `node --test test/*.test.js`（v0.1 親踩）。
