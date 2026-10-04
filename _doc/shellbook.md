# shellbook 

shellbook 是一個結合 Book 與 Shell 的 Node.js 程式，可以讓使用者根據某本載入的書籍，去學習如何透過 Shell 操控電腦，完成一系列的專案或課程學習。

舉例而言，若有一本教你如何 git 的書籍 gitbook/ ，我們只要載入該書後，按照書上的指示，點選 shell 操作範例，那麼 shellbook 就會在 terminal 中，逐步執行該範例，shellbook 會透過 websocket 呼叫後端的 shell 執行。

可以選擇單步執行，也可以選擇整個範例一次執行，這讓使用者可以觀察輸出結果，進而學會書籍所教的內容

在舉例而言，假如有本書教你怎麼用 git+github+opencode+rust+node.js+docker+github action 建立專案並學習軟體工程技巧，那麼你只要根據書上的範例，一個一個點選執行（或者自己在 terminal 中打字執行），最後就能建構出該專案，然後學會這些軟體工程的技巧，同時建立一個完整的專案。

