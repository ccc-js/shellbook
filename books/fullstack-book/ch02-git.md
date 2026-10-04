# 第二章：git 建倉

給 `demo-proj` 立規矩：獨立倉庫、本地身份、第一個 commit。
（跟 gitbook 第二章一樣的手感，這次是為專案服務。）

## 範例 1：建倉＋身份

```sh #run expect:Initialized
cd "$SHELLBOOK_WS"
rm -rf demo-proj
mkdir -p demo-proj
git init -b main demo-proj
git -C demo-proj config user.email "learner@shellbook.local"
git -C demo-proj config user.name "shellbook learner"
```

## 範例 2：README＋首 commit

```bash #run expect:demo-proj
R="$SHELLBOOK_WS/demo-proj"
cat > "$R/README.md" <<EOF
# demo-proj
shellbook fullstack-book 練習專案：node + rust + docker + CI。
EOF
git -C "$R" add README.md
git -C "$R" commit -m "chore: init demo-proj"
git -C "$R" --no-pager log --oneline
```
