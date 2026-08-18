# StockWatch

**你的私人股票儀表板。** 即時報價、互動走勢圖、AI 摘要、多市場支援——一個畫面掌握全局。

**Your personal stock dashboard.** Real-time quotes, interactive charts, AI summaries, multi-market coverage — everything at a glance.

---

## 它能做什麼 / What It Does

### 即時報價 / Real-Time Quotes

每 5 秒更新交易中的股票價格。支援美股、台股、港股、A 股、外匯，自動選擇最佳資料來源（Finnhub、TWSE、新浪財經），找不到時退回 Yahoo Finance。美股盤前盤後價格會另行標示漲跌幅，讓你在非正規交易時段也能掌握最新動態。

Stock prices refresh every 5 seconds during market hours. Covers US, Taiwan, Hong Kong, China A-shares, and forex — automatically picking the best data provider. US pre-market and after-hours prices are displayed separately with their own change indicators, keeping you informed outside regular sessions.

### 市場時鐘 / Market Clock

首頁頂端的市場儀表板即時顯示各大交易所的開盤狀態與當地時間——美股、台股、港股、A 股、歐股、日股。一眼就知道哪個市場正在交易、哪個即將開盤。

The market dashboard at the top of the home screen shows real-time open/close status and local time for major exchanges — US, Taiwan, Hong Kong, China, Europe, and Japan. See at a glance which markets are live and which are about to open.

### 互動走勢圖 / Interactive Charts

純 Canvas 手繪的面積走勢圖，疊加 MA20/60/120 均線與成交量柱狀圖。七個時間區段（24H → Max）即時切換，不閃爍。手指滑過圖表會出現十字線，顯示該日期的價格、漲跌、成交量。底部標示區間最大回撤（MDD）。

Hand-drawn Canvas area charts with MA20/60/120 overlays and volume bars. Seven time ranges (24H through Max) switch seamlessly — no flash, no skeleton reload. Touch or hover to reveal a crosshair with date, price, change, and volume. Max drawdown is shown at the footer.

### AI 摘要 / AI Summaries

每檔股票自動產生一段繁體中文摘要，聚焦近期新聞與財報表現。由 DeepSeek 驅動，每日排程自動更新，也可以手動按 refresh 強制重新產生（一小時冷卻）。外匯標的會切換成匯率分析角色，聚焦央行政策與經濟事件。

Each stock gets a concise AI-generated summary covering recent news and earnings. Powered by DeepSeek, summaries are refreshed daily via scheduler. You can also force a manual refresh (1-hour cooldown). Forex pairs switch to a currency-analyst prompt focusing on central bank policy and macro events.

### 自選股清單 / Watchlists

多清單管理，拖曳排序，跨清單分類。搜尋支援代號、公司名稱、中文幣名。

Multiple watchlists with drag-to-reorder and cross-list organization. Search by ticker, company name, or Chinese currency name.

### 外匯 / Forex

內建 20 組主要貨幣對（USD/TWD、EUR/USD、GBP/JPY 等）。搜尋「美元」或「usd」即可找到。外匯沒有成交量時圖表自動全高顯示價格，基本面欄位自動隱藏。

20 major currency pairs built in (USD/TWD, EUR/USD, GBP/JPY, etc.). Search in English or Chinese. Charts automatically use full height when volume is unavailable; fundamental metrics are hidden gracefully.

---

## 技術架構 / Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────┐
│   Browser    │────▶│  FastAPI  (Python 3.11)                  │
│  Vanilla JS  │◀────│  ├─ /stockprice/:ticker   (即時報價)      │
│  Canvas 2D   │     │  ├─ /history/:ticker      (走勢資料)      │
│              │     │  ├─ /ai-summary/:ticker   (AI 摘要)       │
│              │     │  ├─ /autocomplete/:query  (搜尋)          │
│              │     │  ├─ /auth/client-id       (OAuth)        │
│              │     │  └─ /watchlists/...       (清單 CRUD)     │
└─────────────┘     └──────────┬───────────────────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │  PostgreSQL 15       │
                    │  ├─ stock_prices     │
                    │  ├─ stock_summaries  │
                    │  ├─ watchlist_groups │
                    │  └─ users            │
                    └──────────────────────┘
```

**前端 / Frontend** — 原生 JavaScript + CSS，無框架。圖表用 Canvas 2D 手繪，不依賴外部圖表庫。

**後端 / Backend** — FastAPI + APScheduler。資料來源優先順序：Finnhub (美股) → TWSE (台股) → 新浪財經 (港股/A股) → Yahoo Finance (fallback)。

**資料庫 / Database** — PostgreSQL 15，Docker volume 持久化。每日凌晨 3 點自動備份並輪替。

**認證 / Auth** — Google OAuth 2.0 登入，自簽 JWT 長效 token（30 天），所有 API 端點需登入。

---

## 快速開始 / Quick Start

### 前置需求 / Prerequisites

- Docker & Docker Compose
- Google OAuth 2.0 Client ID & Secret（[建立方式](https://console.cloud.google.com/apis/credentials)）
- DeepSeek API Key（[取得方式](https://platform.deepseek.com/)）
- Finnhub API Key（選用，[取得方式](https://finnhub.io/)）

### 安裝 / Setup

```bash
# 1. 複製專案
git clone https://github.com/kevin319/StockWatch.git
cd StockWatch

# 2. 建立環境變數
cp .env.example .env
# 編輯 .env，填入你的 API keys
```

編輯 `.env` 填入以下必要資訊：

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
JWT_SECRET=your-random-secret-string
DEEPSEEK_API_KEY=your-deepseek-key
POSTGRES_PASSWORD=your-db-password
```

```bash
# 3. 啟動
docker compose up -d --build

# 4. 開啟瀏覽器
open http://localhost:8000
```

首次啟動會自動建立資料庫表格。用 Google 帳號登入後即可開始使用。

On first launch, database tables are created automatically. Sign in with Google and start adding stocks.

---

## 排程任務 / Scheduled Jobs

| 任務 | 時間 | 說明 |
|------|------|------|
| AI 摘要更新 | 每日 07:00 (Asia/Taipei) | 掃描所有自選股，逐一呼叫 DeepSeek 更新摘要 |
| 資料庫備份 | 每日 03:00 (Asia/Taipei) | pg_dump 完整備份，自動輪替保留近期檔案 |

---

## 專案結構 / Project Structure

```
StockWatch/
├── main.py                  # FastAPI app + 排程設定
├── app/
│   ├── api/
│   │   ├── auth.py          # Google OAuth + JWT
│   │   ├── stock.py         # 報價、走勢、基本面、AI 摘要、外匯
│   │   ├── watchlists.py    # 自選股清單 CRUD
│   │   └── providers/       # 各市場資料來源
│   │       ├── finnhub.py   # 美股
│   │       ├── twse.py      # 台股
│   │       └── astock.py    # 港股 / A 股
│   ├── core/
│   │   ├── config.py        # 環境變數設定
│   │   └── security.py      # JWT 驗證
│   └── models/
│       ├── db.py            # PostgreSQL 連線
│       ├── backup.py        # 自動備份
│       └── migrations.py    # 資料庫遷移
├── static/
│   ├── index.html           # 主頁面
│   ├── login.html           # 登入頁
│   ├── main.js              # 前端邏輯 + 圖表繪製
│   ├── watchlists.js        # 清單管理
│   └── styles.css           # 樣式（深淺雙主題）
├── database/                # SQL schema
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── requirements.txt
```

---

## 授權 / License

MIT

---

<p align="center"><sub>Built with FastAPI, vanilla JS, and too much coffee.</sub></p>
