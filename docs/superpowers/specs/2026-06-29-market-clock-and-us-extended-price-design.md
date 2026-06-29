# 設計：Hero 四市場開盤時鐘 + 還原美股盤前/盤後價

日期：2026-06-29

## 目標

1. **Hero 卡片四市場開盤時鐘**：在最上面大卡片右側（標題不動、字較小）顯示美股、台股、陸股、港股的開盤狀態。交易中顯示「交易中」；未開盤顯示下次開盤時間與倒數（HH:MM）。
2. **還原美股盤前/盤後價**：美股收盤後股票列表要同時顯示「正規收盤價（主價）＋盤後價」。

## 背景與根因

- 新增的 Finnhub provider（`app/api/providers/finnhub.py`）讓美股（無 `.` 後綴）改走 Finnhub。Finnhub 免費版 `/quote` 沒有盤前/盤後欄位，provider 寫死 `extended_price=None` → 美股盤前/盤後價消失（原本走 yfinance 才有）。
- 實測（週末完全收盤）yfinance 仍保留 `postMarketPrice`（如 AAPL 282.50、PLTR 112.15），會自動沿用到下次開盤 → **不需資料庫持久化**。
- 現有後端各 provider 已有市場狀態判斷，但美股寫死 UTC-4（不處理冬令 EST）。本次時鐘改用前端 `Intl` + IANA 時區，DST 自動正確；後端不動。

## 需求 2：美股盤前/盤後價（後端）

**檔案**：`app/api/stock.py` `get_stock_price()`

**做法**：在 provider 取得 `response_data` 後、寫入快取/DB 前，加一段：
- 條件：美股（`'.' not in ticker`）且 `market_state` 非 `REGULAR`（即 PRE/POST/POSTPOST/CLOSED）且目前 `extended_price` 為空。
- 動作：呼叫一次 yfinance `Ticker(ticker).info`，依市場狀態取 `preMarketPrice`（PRE）或 `postMarketPrice`（POST/POSTPOST/CLOSED），填入 `extended_price / extended_type / extended_change / extended_change_percent`。
  - `extended_type`：PRE → `'PRE_MARKET'`，其餘 → `'POST_MARKET'`。
  - 漲跌：盤前對 `prev_close`，盤後對 `price`（regular 收盤），與既有 yfinance fallback 邏輯一致。
- 效能：只在非交易時段補打（此時前端輪詢 60s/300s），交易中（10s 輪詢）不打。
- 失敗容錯：yfinance 例外時靜默略過，維持 `extended_price=None`，不影響主報價。

**前端不改**：`renderStocks()` 已在 `extended_price>0` 時顯示「盤後 $xxx」，收盤後自然同時顯示主價（收盤價）＋盤後價。

## 需求 1：Hero 四市場開盤時鐘（純前端）

**檔案**：`static/index.html`（hero-card 結構）、`static/main.js`（時鐘邏輯）、`static/styles.css`（版面）。

**版面**：`.hero-card` 改為 flex 兩欄。左欄維持 eyebrow/標題/caption；右欄新增市場面板（`#marketClock`），四列，每列：市場名 + 狀態。小螢幕（如 ≤480px）右欄移到下方。

每列狀態：
- 交易中（REGULAR）：綠點 +「交易中」。
- 未開盤：`HH:MM開` 顯示下次開盤的**使用者當地時間** + `倒數 HH:MM`。

**市場定義**（IANA 時區 + 正規盤時段，週一至五；午休算休市）：
| 市場 | 時區 | 時段（當地） |
|------|------|------|
| 美股 | America/New_York | 09:30–16:00 |
| 台股 | Asia/Taipei | 09:00–13:30 |
| 港股 | Asia/Hong_Kong | 09:30–12:00, 13:00–16:00 |
| 陸股 | Asia/Shanghai | 09:30–11:30, 13:00–15:00 |

**演算法**（每秒重算）：
1. 用 `Intl.DateTimeFormat(timeZone)` 取得各市場當地 weekday 與時分。
2. 若當地時間落在任一時段內 → 開盤（交易中）。
3. 否則以「當地牆鐘」往後找下一個交易日的第一個開盤時刻，倒數 = `(dayOffset*1440 + openMin) - nowLocalMin`（分鐘）。
4. 倒數格式：`HH:MM`，小時可超過 24（週末約 64:30）；未滿 1 小時如 `00:28`，不顯示秒。
5. 下次開盤時間以使用者當地時間顯示（把目標市場牆鐘換算到本地）。

**取捨**：倒數的跨 DST 投影可能有 1 小時誤差（一年兩次、僅在倒數正好跨越轉換時），為避免引入時區套件而簡化，與專案現有風格一致。不處理國定假日。

**啟動**：在 `initializeStocks()` 或 DOMContentLoaded 啟動 `setInterval(renderMarketClock, 1000)`。

## 不在範圍

- 不修後端既有市場狀態（Finnhub UTC-4）邏輯。
- 不處理各市場國定假日。
- 不做盤前/盤後價的資料庫持久化（yfinance 自帶沿用）。
