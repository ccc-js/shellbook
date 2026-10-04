# 第三章：分支與合併

先來一次乾淨合併，再故意製造衝突、解決衝突。
注意：`git merge` 預期會失敗的那次加了 `|| true`，
否則全跑模式會停在那裡（這是 shellbook 的失敗即停保護）。

## 範例 1：開分支、合併（乾淨）

```sh #run expect:merge
R="$SHELLBOOK_WS/gitbook-play/hello-git"
git -C "$R" branch -D feature 2>/dev/null || true
git -C "$R" checkout -b feature
printf 'feature work\n' > "$R/feature.txt"
git -C "$R" add feature.txt
git -C "$R" commit -m "add feature"
git -C "$R" checkout main
git -C "$R" merge --no-ff feature -m "merge feature"
git -C "$R" --no-pager log --oneline -5
```

## 範例 2：製造衝突（預期失敗，加 || true）

```bash #step expect:feature2
R="$SHELLBOOK_WS/gitbook-play/hello-git"
git -C "$R" checkout main
printf 'main line\n' > "$R/hello.txt"
git -C "$R" commit -am "main edits hello"
git -C "$R" branch -D feature2 2>/dev/null || true
git -C "$R" checkout -b feature2
printf 'feature2 line\n' > "$R/hello.txt"
git -C "$R" commit -am "feature2 edits hello"
git -C "$R" checkout main
printf 'main line v2\n' > "$R/hello.txt"
git -C "$R" commit -am "main edits hello again"
git -C "$R" merge feature2 || true
```

## 範例 3：看衝突、解決、完成合併

```bash #run expect:resolved
R="$SHELLBOOK_WS/gitbook-play/hello-git"
git -C "$R" status --short
printf 'resolved line\n' > "$R/hello.txt"
git -C "$R" add hello.txt
git -C "$R" commit -m "resolve conflict"
git -C "$R" --no-pager log --oneline -5
```
