# 第九章：Actions CI/CD

第五章寫的 workflow 推上去後就會跑。這章學：
看 workflow 清單、看最近的 runs、給 README 掛徽章。
`gh run watch` 會等到天荒地老就不自動跑了（想看去瀏覽器）；
`badge` 改檔＋commit 是本地操作，隨時可跑。

## 範例 1：看 workflow 有沒有被 GitHub 吃到

```sh #run expect:GH_
R="$SHELLBOOK_WS/demo-proj"
if TERM=dumb gh auth status >/dev/null 2>&1; then
  cd "$R"
  TERM=dumb gh workflow list || echo "（看不到？先跑 ch07 建倉推上去）"
  echo "AUTO: workflow 清單如上（GH_LOGGED_IN）"
else
  echo "MANUAL: 推上去後到瀏覽器 https://github.com/你的帳號/shellbook-demo/actions 看（GH_NEED_LOGIN）"
fi
```

## 範例 2：看最近的 runs（只看不追）

```bash #run expect:GH_
R="$SHELLBOOK_WS/demo-proj"
if TERM=dumb gh auth status >/dev/null 2>&1; then
  cd "$R"
  TERM=dumb gh run list --limit 5 || echo "還沒有 run（push 後才會有）"
  echo "AUTO: run 清單如上（GH_LOGGED_IN）"
else
  echo "MANUAL: 瀏覽器 Actions 頁點進某次 run，看 jobs 一格一格變綠（GH_NEED_LOGIN）"
fi
```

## 範例 3：掛 CI 徽章（本地改檔＋commit，免登入）

```bash #run expect:BADGE_OK
R="$SHELLBOOK_WS/demo-proj"
grep -q "actions/workflows" "$R/README.md" 2>/dev/null || cat >> "$R/README.md" <<EOF

[![ci](https://github.com/你的帳號/shellbook-demo/actions/workflows/ci.yml/badge.svg)](https://github.com/你的帳號/shellbook-demo/actions)
EOF
grep -q "badge.svg" "$R/README.md" && echo BADGE_OK
git -C "$R" add README.md
git -C "$R" commit -m "docs: ci badge" || echo ALREADY_COMMITTED
git -C "$R" --no-pager log --oneline -3
```

做完把 `你的帳號` 換成自己帳號再 push，徽章就會亮。
下一章（v0.8 以後）可以玩 `gh run watch` 追一次完整的綠燈。
