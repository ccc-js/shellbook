# 第一章：環境檢查

學 git 前先確認工具在、場地清好。本書所有操作都在 `$SHELLBOOK_WS`
（shellbook 的 workspace 沙盒）裡，不動你電腦其他地方。

## 範例 1：git 在嗎

```sh #run expect:git
cd "$SHELLBOOK_WS"
git --version
```

## 範例 2：清出場地

```bash #step
cd "$SHELLBOOK_WS"
mkdir -p gitbook-play
ls gitbook-play
```
