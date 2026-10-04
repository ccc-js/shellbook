# 第四章：遠端協作（本地模擬）

不用真的上 GitHub：用一個本地 bare 倉庫當「遠端」，
push 上去再 clone 下來驗證，流程一模一樣。

## 範例 1：建遠端、掛 origin

```sh #run expect:origin
P="$SHELLBOOK_WS/gitbook-play"
R="$P/hello-git"
rm -rf "$P/upstream.git" "$P/verify"
git init --bare "$P/upstream.git"
git -C "$R" remote remove origin 2>/dev/null || true
git -C "$R" remote add origin "$P/upstream.git"
git -C "$R" remote -v
```

## 範例 2：push 上去

```bash #run expect:main
R="$SHELLBOOK_WS/gitbook-play/hello-git"
git -C "$R" push -u origin main
git -C "$R" --no-pager log --oneline -3
```

## 範例 3：clone 下來驗證

```bash #run expect:hello.txt
P="$SHELLBOOK_WS/gitbook-play"
git clone "$P/upstream.git" "$P/verify"
ls "$P/verify"
```
