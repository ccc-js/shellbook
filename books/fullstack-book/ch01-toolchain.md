# 第一章：工具鏈盤點

開工前先盤點武器：版本都叫得出來才算數。
`gh` 只要裝好、叫得出版本就好（本章不做任何要登入的操作）；
`opencode` 的用法會在每一章的解說裡用到，環境裡有沒有都可繼續。

## 範例 1：核心四件套

```sh #run expect:version
git --version
node --version
npm --version
```

## 範例 2：延伸工具（rust / docker / github CLI）

```bash #step expect:version
cargo --version
rustc --version
docker --version
docker info >/dev/null 2>&1 && echo DOCKER_DAEMON_OK
TERM=dumb gh --version
```

> 小知識：`gh` 啟動會查詢終端機能力（顏色/游標），在沒有真終端
> 回應的環境會卡住等；`TERM=dumb` 讓它跳過查詢。這是自動化環境
> 常見的坑，記下來以後除錯用得上。
