# 第二章：檔案小練習

學 `mkdir`、`cat`、`grep`。做完後 `workspace/demo-play/` 底下會有你建的檔案。

## 範例 1：建目錄寫檔

```sh #run cwd:workspace/demo-play
mkdir -p demo-play
echo "apple banana apple" > demo-play/fruit.txt
cat demo-play/fruit.txt
```

## 範例 2：過濾關鍵字（單步）

```bash #step expect:apple
grep apple demo-play/fruit.txt
grep -c apple demo-play/fruit.txt
```
