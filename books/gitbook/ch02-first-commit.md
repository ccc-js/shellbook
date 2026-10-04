# 第二章：第一次 commit

建一個 `hello-git` 倉庫：初始化 → 設身份（只設這個倉庫，不動你的全域設定）
→ 寫檔 → commit → 看歷史。

## 範例 1：建倉＋設身份

```sh #run expect:Initialized
cd "$SHELLBOOK_WS"
rm -rf gitbook-play/hello-git
mkdir -p gitbook-play/hello-git
git init -b main gitbook-play/hello-git
git -C gitbook-play/hello-git config user.email "learner@shellbook.local"
git -C gitbook-play/hello-git config user.name "shellbook learner"
git -C gitbook-play/hello-git config --list | grep user
```

## 範例 2：寫檔、commit、看歷史（單步）

```bash #step expect:first
R="$SHELLBOOK_WS/gitbook-play/hello-git"
printf 'hello git\n' > "$R/hello.txt"
git -C "$R" add hello.txt
git -C "$R" commit -m "first commit"
git -C "$R" status --short
git -C "$R" --no-pager log --oneline
```
