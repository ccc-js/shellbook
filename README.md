# shellbook

A web interface for shell, learn from book step by step.

shellbook 把「書」和「終端機」放在同一個畫面：左邊（上半）是互動書籍，
下面是真的 shell。照著書點範例（單步或整塊），指令就真的跑起來，
看著輸出學會它。

```
┌─────────────────────────────────┐
│ 功能表：書籍・章節・session      │  1 row
├─────────────────────────────────┤
│  book 區（Markdown 互動書）     │  剩餘全部，可拉動
╞═════════════════════════════════╡  分隔條（拖曳／雙擊回 20 rows）
│  shell 區（真的 shell）         │  預設 20 rows
└─────────────────────────────────┘
```

## 5 分鐘跑起來

需要 Node.js 20+（`node --version` 確認）。

```sh
git clone https://github.com/ccc-js/shellbook.git
cd shellbook
npm install
npm start
# 開 http://localhost:3000
```

或用 CLI（可指定書、port、書籍目錄）：

```sh
npx shellbook gitbook --open
shellbook --port 3000 --books-dir ./my-books --open
```

或用 Docker（全工具鏈：node＋rust＋gh＋docker-cli，見 `Dockerfile`）：

```sh
docker compose up --build
# 開 http://localhost:3000
```

打開後：上面選一本書 → 照著按範例的「全跑 ▶▶」或「單步 ▶|」→
看 shell 輸出 → 右上徽章變 `✓ 已完成`。快捷鍵（焦點在 terminal）：
`Ctrl/⌘+Enter` 全跑目前範例，`Shift+Enter` 單步。

## 內建的三本書

| 書 | 內容 |
|---|---|
| `demo` | shell 第一課（2 章，暖身用） |
| `gitbook` | git 實戰：init→commit→分支合併→本地遠端（4 章，零網路） |
| `fullstack-book` | 軟體工程實戰：git＋node＋rust＋docker＋CI（5 章，跑完長出 `demo-proj/`） |
| `fullstack-github` | 上冊＋GitHub 篇：授權＋建倉＋fork/PR＋Actions（9 章；會動帳號的步驟自動偵測權限，沒登入就印手動指引） |

## 自己寫一本書

1. 在 `books/` 下開目錄（名只許 `[a-z0-9-]`），放 `book.json`＋章節 `.md`：

```json
{
  "name": "mybook",
  "title": "我的書",
  "version": "0.1.0",
  "chapters": ["ch01-hello.md", "ch02-more.md"]
}
```

2. 章節是 Markdown；想讓範例可執行，fence 加標籤：

````markdown
```sh #run expect:hello
echo hello
```

```bash #step cwd:workspace/play
pwd
ls
```
````

`#run` 整塊跑、`#step` 可單步；`cwd:`/`expect:` 是提示（expect 會自動對輸出打勾）。
完整規則見 `_doc/BOOK.md`（含血淚整理的安全寫法：禁 pager／禁互動／
hermetic git 身份／每塊先 `cd "$SHELLBOOK_WS"`／會動帳號的包授權檢查）。

3. 重啟 server（或用自己的 `--books-dir`），書就上架了。
   照 `_doc/BOOK.md` 寫，範例全都會被 e2e 真跑驗證（見 `test/v04*`、`v07` 的寫法）。

## 安全須知（先讀再對外開）

- 預設只綁 `127.0.0.1`。`--host 0.0.0.0` 對外前先理解風險：
  任何連得上的人都能跑 shell（deny-list 只擋「已知危險」，不是沙盒虛擬化）。
- deny-list 擋 `rm -rf /`、mkfs、關機、fork bomb 等（`src/guard.js`）；
  每個 session 是獨立 pty＋獨立 `workspace/sessions/<id>/` 沙盒；
  危險範例執行前會二次確認。但這仍不是完整隔離：
  **不信任的書不要跑，更不要把 server 裸奔在公網上。**
- `docker compose` 掛了 `/var/run/docker.sock`（書裡要用 docker），
  sock 權力很大，只給可信環境用。

## 更多文件

- `_doc/plan0.x.md` — 版本路線圖（v0.1→v1.0）
- `_doc/v0.1.md`～`_doc/v0.7.md` — 每版做了什麼＋踩坑
- `_doc/BOOK.md` — 書籍作者規格
- `_doc/API.md` — REST＋websocket 協定
- `CHANGELOG.md` — 版本紀錄
- `config/shellbook.json` — 上限／超時／輸出上限／warn 清單（全可被 `SHELLBOOK_*` env 覆寫）
