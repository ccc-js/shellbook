# 第八章：fork＋Pull Request

開源協作基本功：fork 別人的倉 → 改 → 開 PR。
練習對象是 `octocat/Spoon-Knife`（GitHub 官方 fork 練習倉）。
有權限 → 自動 fork＋clone＋開分支＋推＋開 PR；
沒權限 → 照手動步驟在瀏覽器點，流程一模一樣。

## 範例 1：fork＋clone 下來

```sh #run expect:GH_
cd "$SHELLBOOK_WS"
if TERM=dumb gh auth status >/dev/null 2>&1; then
  TERM=dumb gh repo view Spoon-Knife >/dev/null 2>&1 || TERM=dumb gh repo fork octocat/Spoon-Knife --clone=false
  ME=$(TERM=dumb gh api user --jq .login)
  rm -rf Spoon-Knife
  TERM=dumb gh repo clone "$ME/Spoon-Knife" Spoon-Knife
  ls Spoon-Knife
  echo "AUTO: fork 已 clone（GH_LOGGED_IN）"
else
  echo "MANUAL: 瀏覽器開 https://github.com/octocat/Spoon-Knife 按 Fork，再 clone 自己的那份（GH_NEED_LOGIN）"
fi
```

## 範例 2：開分支、改檔、推上去

```bash #run expect:GH_
R="$SHELLBOOK_WS/Spoon-Knife"
if TERM=dumb gh auth status >/dev/null 2>&1; then
  git -C "$R" checkout shellbook-practice 2>/dev/null || git -C "$R" checkout -b shellbook-practice
  printf 'shellbook practice\n' >> "$R/README.md"
  git -C "$R" add README.md
  git -C "$R" commit -m "shellbook: practice edit" || echo ALREADY_COMMITTED
  git -C "$R" push -u origin shellbook-practice
  echo "AUTO: 分支已推（GH_LOGGED_IN）"
else
  echo "MANUAL: 在自己 fork 的 Spoon-Knife 按分支鈕開 shellbook-practice，改個檔 commit（GH_NEED_LOGIN）"
fi
```

## 範例 3：開 PR（重跑不重開）

```bash #run expect:GH_
R="$SHELLBOOK_WS/Spoon-Knife"
if TERM=dumb gh auth status >/dev/null 2>&1; then
  cd "$R"
  OPEN=$(TERM=dumb gh pr list --head shellbook-practice --json number --jq length)
  if [ "$OPEN" = "0" ]; then
    git push -u origin shellbook-practice
    TERM=dumb gh pr create --title "shellbook 練習 PR" --body "照著 shellbook fullstack-github 第八章開的練習 PR" --head shellbook-practice
  else
    echo "已有進行中的 PR，不重開"
  fi
  TERM=dumb gh pr list --head shellbook-practice
  echo "AUTO: PR 就緒（GH_LOGGED_IN），合併請到瀏覽器按 Merge"
else
  echo "MANUAL: 到自己 fork 的頁面按 Compare & pull request 開 PR（GH_NEED_LOGIN）"
fi
```

## 手動收尾（人人都要會，瀏覽器操作）

1. 開自己 fork 的 `Spoon-Knife` 頁面 → Pull requests → 看到剛開的 PR。
2. 按 Merge pull request → Confirm merge，完成一次完整協作流程。
3. （選做）回 terminal 跑 `git -C Spoon-Knife pull` 把合併拉回來。
