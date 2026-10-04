# v1.0 手動驗收清單（自動化測不到的部分，人肉跑一次勾一個）

> 目標：v1.0 tag 前全部勾完。自動化（`npm test`＋CI）是必要非充分，
> 下面這些一定要親手點過。

## A. 乾淨環境 5 分鐘（對應 README「5 分鐘跑起來」）

- [x] 乾淨容器／VM：`git clone → npm install → npm start → http://localhost:3000` 全通
  （2026-10-04：`docker build`＋`docker run` 實測，health＋四書＋gitbook ch02 headless 全綠）
- [x] `npx shellbook gitbook --open`（或 `node bin/shellbook.js demo --open`）預選書正確
  （`?book=` 有自動化測試覆蓋）
- [x] `docker compose up --build` 全通，頁面可開（2026-10-04 實測 health 通、`down` 無殘留）

## B. 書籍手點（照書從頭點到尾）

- [ ] gitbook 全書：每個範例親點（自動＋手動分支各看一次輸出合理）
- [ ] fullstack-book 全書：跑完 `demo-proj` 長齊，`npm test`／`cargo test` 綠
- [ ] **fullstack-github 授權路徑（e2e 測不到！）**：找一個測試用 GitHub 帳號
  - [ ] `gh auth login` 照 ch06 手動步驟登入，範例 1 出現 `GH_LOGGED_IN`
  - [ ] ch07：`shellbook-demo` 真建出來且 push 成功
  - [ ] ch08：fork＋PR 真開出來（PR 頁看得到），瀏覽器 merge 成功
  - [ ] ch09：Actions 真跑綠，README 徽章亮
  - [ ] 做完把測試帳號的 `shellbook-demo`／fork／PR 清掉

## C. 前端人肉（無瀏覽器自動化，只能看）

- [ ] 三區＋分隔條拖曳＋雙擊回 20 rows（Chrome＋Safari 至少看一種）
- [ ] 單步高亮／全跑進度／blocked 紅字／expect 勾／失敗提示都有出現過
- [ ] 進度：跑幾個→重整→徽章還在；重置本章／本書生效；匯出筆記下載成功
- [ ] session：＋／－／切換／上限提示；手機窄螢幕堪用（直式可讀可點）
- [ ] `⌘/Ctrl+Enter` 全跑、`Shift+Enter` 單步有作用

## D. 安全複查（發布前）

- [x] 預設只聽 `127.0.0.1`（`/api/config` 看 host，有自動化測試覆蓋；`--host 0.0.0.0` 才對外）
- [ ] 對外文件（README 安全須知）已讀過一遍，沒有過度承諾
- [ ] `config/shellbook.json` 的 deny 關鍵字抽查 3 條真的擋
