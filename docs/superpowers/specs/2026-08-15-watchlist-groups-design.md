# 設計：自選股清單分組（Watchlist Groups）

日期：2026-08-15

## 目標
把「一個使用者一份自選股清單」擴充成「一個使用者多份清單」。使用者可建立／改名／刪除／排序清單，
點左上角清單名開左側抽屜切換清單。同一支股票可同時屬於多個清單（多重歸屬）。

## 現況
- `watchlist_stocks(user_email, ticker, display_order)`，唯一索引 `(user_email, ticker)` —「一人一份清單」寫死在 schema。
- 前端 `static/main.js` 全域 `stocks[]` 由 `GET /watchlist/{user_email}` 載入，設定頁可拖曳排序／刪除。
- 排程 `_refresh_all_summaries` 以 `_db_distinct_watchlist_tickers()`（全域 distinct ticker）為對象。

## 方案取捨
排除「在 `watchlist_stocks` 加 `group_name` 文字欄」：空清單無法存在（新建清單在加入第一支股票前不存在）、
改名需 UPDATE 全表、清單順序無處可放。故採正規化新表。

## 資料模型

新表：
```sql
CREATE TABLE watchlists (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    display_order INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_watchlists_user ON watchlists(user_email, display_order);
CREATE UNIQUE INDEX idx_watchlists_user_name ON watchlists(user_email, lower(name));
```

`watchlist_stocks` 改動：
- 新增 `watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE`
- 移除唯一索引 `idx_unique_user_ticker (user_email, ticker)`
- 新增唯一索引 `(watchlist_id, ticker)` ← 多重歸屬的關鍵：同一 ticker 可出現在不同 watchlist_id
- `user_email` 欄位保留（現有查詢與排程沿用，避免大範圍改寫）
- `display_order` 語意改為「清單內的順序」

規則：
- 每位使用者永遠至少有一個清單。刪到剩一個時，刪除操作回 400、UI 停用刪除鍵。
- 清單名長度 1–50 字，同一使用者不分大小寫不可同名。
- 清單數量不設上限，抽屜列表超出畫面時內部捲動。

## 遷移
沿用專案既有慣例（`main.py` 的 `_ensure_summary_table()`）：在 `lifespan` 加 idempotent 的
`_ensure_watchlist_groups()`，啟動時自動完成，失敗只記 log 不讓 app 崩潰。步驟：

1. `CREATE TABLE IF NOT EXISTS watchlists (...)` 與其索引
2. 為每個在 `watchlist_stocks` 有資料、但尚無任何 watchlists 列的 `user_email`，
   建立一個 `name='自選股'`、`display_order=0` 的清單
3. `ALTER TABLE watchlist_stocks ADD COLUMN IF NOT EXISTS watchlist_id INTEGER`
4. `UPDATE watchlist_stocks` 把 `watchlist_id IS NULL` 的列指到該使用者的預設清單
5. 加上 FK 與 `SET NOT NULL`；`DROP INDEX IF EXISTS idx_unique_user_ticker`；
   `CREATE UNIQUE INDEX IF NOT EXISTS` 於 `(watchlist_id, ticker)`

每一步都要能重複執行而無副作用（以 `IF NOT EXISTS` / `WHERE NOT EXISTS` 條件保護）。
同步更新 `database/01_create_table.sql`，讓全新環境初始化即為最終 schema。

新使用者：`GET /watchlists/{user_email}` 若查無任何清單，後端 lazy 建立一個「自選股」空清單再回傳。

## API（app/api/stock.py）

| 端點 | 用途 |
|---|---|
| `GET /watchlists/{user_email}` | 清單列表 `[{id, name, display_order, count}]`，`count` 為該清單股票數；無清單時 lazy 建立預設清單 |
| `POST /watchlists` | `{user_email, name}` → 新增清單，`display_order` = 目前最大值 + 1 |
| `PATCH /watchlists/{watchlist_id}` | `{name}` → 改名 |
| `DELETE /watchlists/{watchlist_id}` | 刪清單（CASCADE 刪其歸屬列，不影響同一支股票在其他清單的歸屬）；剩最後一個時回 400 |
| `POST /watchlists/reorder` | `{user_email, ids: []}` → 依陣列順序寫 `display_order` |
| `GET /watchlists/{watchlist_id}/stocks` | 該清單股票；回傳欄位與現有 `/watchlist/{email}` 完全相同（前端渲染邏輯不必改） |
| `GET /watchlist/memberships/{user_email}/{ticker}` | 回 `[watchlist_id]`，開清單選擇器時預先勾選 |
| `PUT /watchlist/memberships` | `{user_email, ticker, watchlist_ids: []}` 全量覆蓋該 ticker 的歸屬：勾選的加入（`display_order` 接在該清單末端）、未勾選的移除。同時服務「新增股票」與「改歸屬」 |
| `DELETE /watchlists/{watchlist_id}/stocks/{ticker}` | 從單一清單移除（設定頁刪除鍵） |
| `POST /watchlist/reorder` | 既有端點加上 `watchlist_id`，排序範圍限縮在該清單內 |

汰除：`GET /watchlist/{user_email}`、`POST /watchlist/add`、`DELETE /watchlist/{user_email}/{ticker}`。
前端是唯一使用者，不留相容層。

授權：所有吃 `watchlist_id` 的端點須先確認該 id 屬於請求帶的 `user_email`，否則回 404。
（既有端點本來就不驗證呼叫者身分——知道 email 即可讀寫，這是本次改動前既存的缺口，不在本次範圍內修，
但新端點不得比現況更鬆。）

## 前端

### 頂部與抽屜
- `static/index.html` 的 `.nav-title`（`My Stock`）換成按鈕：`≡ {目前清單名} ▾`，點擊 `toggleWatchlistDrawer()`。
  更新時間與右側兩顆 icon 位置不變。
- 新增 `#watchlistDrawer`：左側滑出面板 + 半透明遮罩。點遮罩或 ESC 關閉。
  ```
  我的清單
  ┃ 自選股      (13)   ← 目前清單：左側藍條 + 高亮
    US          (30)
    TW           (8)
  ─────────────────
  ✎ 管理        + 新增清單
  ```
- 「管理」就地切換抽屜為管理模式：每列變成 `⠿ 拖曳把手 / 名稱（點擊變 inline input 改名）/ ⊖ 刪除`。
  拖曳復用設定頁既有的 `handleTouchStart / handleTouchMove / handleTouchEnd / handleMouseDown` 一套邏輯。
- 「+ 新增清單」在抽屜內就地展開一個 input，Enter 送出。

### 狀態與連動
- 新增全域 `watchlists = []`、`currentWatchlistId`。
- `currentWatchlistId` 存於 `localStorage['sw-current-watchlist']`，重開回到同一清單；
  若該 id 已不存在（別處刪除），退回第一個清單。
- 初始化順序：`GET /watchlists/{email}` → 決定 `currentWatchlistId` → `GET /watchlists/{id}/stocks` → 既有渲染流程。
- 切換清單：收合展開中的個股（`expandedTicker = null`）、重抓該清單股票、重繪、重置輪詢、關閉抽屜。
- 價格輪詢只更新目前清單的股票（不預抓其他清單）。

### 加入股票
- 點搜尋結果不再直接加入，改開底部彈出的清單選擇器：列出所有清單 + checkbox，
  以 `GET /watchlist/memberships` 預先勾選，確認後 `PUT /watchlist/memberships`。
- 若送出後該 ticker 屬於目前清單，就地更新 `stocks[]` 並重繪；否則只更新抽屜的清單計數。

### 其他
- 設定頁「自選股」區塊維持原樣，內容為「目前清單」的股票；區塊標題改為顯示目前清單名；
  刪除鍵改呼叫 `DELETE /watchlists/{id}/stocks/{ticker}`。
- 空清單顯示「這個清單還沒有股票，用下方搜尋加入」。
- Hero card 摘要（`updateHeroCaption`）基於 `stocks[]`，自動反映目前清單，不需改動。

## 不在範圍
- 端點的身分驗證（既有缺口，另案處理）。
- 清單分享、追蹤他人清單（參考圖的 Following Lists）。
- 清單內排序規則（依漲跌幅/價格排序）、清單層級的統計。
- 從股票列直接開歸屬選擇器的入口（搜尋同一支股票即可看到已勾選狀態並修改）。

## 驗證
- 遷移：對含既有資料的資料庫執行兩次 `_ensure_watchlist_groups()`，確認 idempotent、
  既有自選股全數落在「自選股」清單、筆數不變。
- 後端：curl 走完清單 CRUD、reorder、memberships 全量覆蓋（加入/移除/同一 ticker 跨兩清單）、
  刪最後一個清單回 400、跨使用者存取 watchlist_id 回 404。
- 前端：playwright 截圖確認抽屜開合、切換清單、管理模式拖曳與改名、清單選擇器多選、空清單狀態。
- Guard：`tests/test_main.py` 既有測試通過。
