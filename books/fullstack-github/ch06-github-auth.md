# 第六章：GitHub 授權

分成兩條路：terminal 有權限（`gh auth status` 過）→ 後面章節自動執行；
沒權限 → 照手動步驟在瀏覽器授權，做完重跑本塊。
所有「會動到你 GitHub 帳號」的範例都用這個 `if` 包起來，
沒登入時只印手動指引，絕不亂動。

## 範例 1：檢查 terminal 有沒有權限

```sh #run expect:GH_
TERM=dumb gh auth status || true
if TERM=dumb gh auth status >/dev/null 2>&1; then
  echo "GH_LOGGED_IN：terminal 已有權限，後面章節自動執行"
else
  echo "GH_NEED_LOGIN：請照下方手動步驟授權，做完重跑這塊"
fi
```

## 手動步驟（沒權限才做，在你自己的 terminal＋瀏覽器操作）

1. 在 terminal 跑 `gh auth login`，選 GitHub.com → HTTPS → 用瀏覽器開裝置碼授權。
2. 完成後重跑上面的範例 1，看到 `GH_LOGGED_IN` 再往下。

```
gh auth login
```

## 範例 2：確認連得到 github.com（唯讀，免登入也通）

```bash #run expect:HEAD
git ls-remote https://github.com/octocat/Spoon-Knife HEAD
```
