# 第七章：在 GitHub 建倉並推送

把第二章建的 `demo-proj` 推上 GitHub，倉庫取名 `shellbook-demo`。
有權限 → terminal 自動建倉＋掛 remote＋push；
沒權限 → 照手動步驟在瀏覽器建空倉，再回來掛 remote 推。

## 範例 1：建遠端倉（有則跳過）＋掛 origin

```sh #run expect:GH_
R="$SHELLBOOK_WS/demo-proj"
if TERM=dumb gh auth status >/dev/null 2>&1; then
  TERM=dumb gh repo view shellbook-demo >/dev/null 2>&1 || TERM=dumb gh repo create shellbook-demo --public --description "shellbook 練習專案"
  URL=$(TERM=dumb gh repo view shellbook-demo --json url --jq .url)
  git -C "$R" remote remove origin 2>/dev/null || true
  git -C "$R" remote add origin "$URL"
  git -C "$R" remote -v
  echo "AUTO: 遠端就緒（GH_LOGGED_IN）"
else
  echo "MANUAL: 請到瀏覽器 https://github.com/new 建一個 public 空倉叫 shellbook-demo（GH_NEED_LOGIN）"
fi
```

## 手動步驟（沒權限才做）

1. 瀏覽器開 https://github.com/new，Repository name 填 `shellbook-demo`，選 Public，不要加 README（空倉），Create。
2. 跑下面範例 2，它會印出兩行指令，把 `你的帳號` 換成自己帳號後貼到 terminal 推上去。

## 範例 2：推送 main 上去（自動推；手動貼上推）

```bash #run expect:GH_
R="$SHELLBOOK_WS/demo-proj"
if TERM=dumb gh auth status >/dev/null 2>&1; then
  git -C "$R" push -u origin main
  echo "AUTO: 已推送（GH_LOGGED_IN）"
else
  echo "MANUAL: 瀏覽器建好空倉後，把下面兩行貼到 terminal 自己推（GH_NEED_LOGIN）"
  echo "  git -C $R remote add origin https://github.com/你的帳號/shellbook-demo.git"
  echo "  git -C $R push -u origin main"
fi
```

注意：手動分支只「印出」指令不執行，由你在 terminal 貼上執行
（HTTPS push 會問帳密／token）；若連 push 權限都沒有，就整段留在瀏覽器操作，
知道流程即可，不必硬推。
