# 設計：股票列點擊展開基本面（手風琴）

日期：2026-06-29

## 目標
點任一股票列 → 該列下方平滑展開（手風琴）一塊基本面面板，顯示 8 項指標：
P/E、P/B、P/S、EPS、Dividend、Div Yield、52 Week High、52 Week Low。再點收合。一次只開一個。

## 後端：`GET /fundamentals/{ticker}`（app/api/stock.py）
- 以 `asyncio.to_thread(lambda: yf.Ticker(ticker).info)` 取得（非阻塞），擷取：
  - pe=`trailingPE`、pb=`priceToBook`、ps=`priceToSalesTrailing12Months`、eps=`trailingEps`、
    dividend=`dividendRate`、divYield=`dividendYield`、week52High=`fiftyTwoWeekHigh`、week52Low=`fiftyTwoWeekLow`
- 缺值回 `null`。各市場通用（yfinance 對 .TW/.HK/.SS/.SZ 皆可）。
- 模組級 `fundamentals_cache`，TTL 6 小時（基本面變動慢）。
- 例外回 `{ticker, error}`，前端容錯顯示「—」。
- 單位：`divYield` 已是百分比數字（直接加 %）；`dividend`/`eps`/52 週高低為當地幣別金額。

## 前端（static/main.js、index.html?、styles.css）
- 狀態：`expandedTicker`（目前展開的代號，一次一個）、`fundData`（ticker→資料或 'loading'）、`expandAnimate`（一次性動畫旗標）。
- `renderStocks`：每檔包進 `.stock-item`（含 `.v2-row` + `.stock-detail`）。`.v2-row` 加點擊 → `toggleExpand(ticker)`。
- `toggleExpand`：同代號則收合（expandedTicker=null）；否則設為該代號，若 `fundData` 未快取則 `loadFundamentals(ticker)`（fetch /fundamentals → 存快取 → 重繪），並設 `expandAnimate=true`。重繪。
- 重繪時：`expandedTicker` 對應的列才渲染 `.stock-detail` 內容；價格輪詢（每 10s）重繪會**保持展開、不重抓**；`expandAnimate` 只讓首次展開播放滑入動畫，播放後清除（沿用 priceFlash 手法）。
- 面板版面：2 欄 × 4 列指標格，每格「標籤（小灰）＋數值（粗）」。
  - 格式化：數值 2 位小數；缺值/非正值（P/E 等）顯示「—」；金額前綴用既有 `currencySymbol(ticker)`；殖利率加 `%`。
  - 未載入時顯示骨架（沿用 `.sk` shimmer）。
- 動畫：展開滑入（CSS keyframe），收合即時。

## 不在範圍
- 圖表、開高低量、新聞。
- 收合的退場動畫（先即時收合）。

## 驗證
- 後端：curl /fundamentals 對美/台/港/陸股回正確 8 欄。
- 前端：playwright 截圖確認展開面板版面、缺值「—」、輪詢時保持展開。
- Guard：8 單元測試通過。
