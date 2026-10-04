# 第五章：Docker＋CI

把專案裝箱：寫 `Dockerfile`、build、run 看到問候語；
再寫一條 GitHub Actions workflow（本地只做靜態檢查，
`grep` 到關鍵字就算數，真的 CI 等你 push 才會跑）。

## 範例 1：寫 Dockerfile＋build

```sh #run expect:shellbook-demo
R="$SHELLBOOK_WS/demo-proj"
printf 'hello-from-shellbook\n' > "$R/greeting.txt"
cat > "$R/Dockerfile" <<EOF
FROM alpine:3.21
WORKDIR /app
COPY greeting.txt /app/
CMD ["cat", "/app/greeting.txt"]
EOF
printf '.git/\nrust-app/target/\nnode_modules/\n' > "$R/.dockerignore"
cd "$R" && docker build -t shellbook-demo .
```

## 範例 2：run 起來看問候語

```bash #run expect:hello-from-shellbook
docker run --rm shellbook-demo
```

## 範例 3：寫 CI workflow＋本地檢查＋commit

```bash #run expect:CI_NODE_OK
R="$SHELLBOOK_WS/demo-proj"
mkdir -p "$R/.github/workflows"
cat > "$R/.github/workflows/ci.yml" <<EOF
name: ci
on: [push]
jobs:
  node:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo test --offline
EOF
grep -q "npm test" "$R/.github/workflows/ci.yml" && echo CI_NODE_OK
grep -q "cargo test" "$R/.github/workflows/ci.yml" && echo CI_RUST_OK
git -C "$R" add Dockerfile .dockerignore greeting.txt .github
git -C "$R" commit -m "feat(docker-ci): image and workflow"
git -C "$R" --no-pager log --oneline -5
```
