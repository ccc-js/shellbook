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
