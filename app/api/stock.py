from fastapi import APIRouter, Depends
import asyncio
import yfinance as yf
import yahooquery as yq
from app.models.db import get_db_connection
from psycopg2.extras import RealDictCursor
from datetime import datetime, timedelta
from app.core.config import settings
from app.core.security import current_user_email
from app.api.providers.finnhub import fetch_finnhub_quote
from app.api.providers.twse import fetch_twse_quote
from app.api.providers.astock import fetch_astock_quote

router = APIRouter()

# 記錄最後一次 upsert 的時間
last_upsert_times = {}

# 記錄 Yahoo Finance 的快取
yahoo_cache = {}

# sparkline 走勢快取（變動慢，快取較久）
sparkline_cache = {}

# 歷史走勢快取（含 OHLCV + MA + MDD）
history_cache = {}

# 基本面快取（變動更慢）
fundamentals_cache = {}


async def _supplement_us_extended(ticker: str, data: dict) -> None:
    """美股經 Finnhub 取得時補上盤前/盤後價（Finnhub 免費版無此資料）。

    直接修改傳入的 data。yfinance 在完全收盤時仍保留 postMarketPrice，
    會沿用至下次開盤，故不需另做持久化。失敗時靜默略過。
    """
    try:
        info = await asyncio.to_thread(lambda: yf.Ticker(ticker).info) or {}
        # 順路補缺的公司名（Finnhub 對 ETF 常回空名），避免前端只能顯示代號
        if not data.get('company_name'):
            data['company_name'] = info.get('longName') or info.get('shortName') or ''
        state = data.get('market_state', '')
        if state == 'PRE':
            pre = info.get('preMarketPrice')
            if pre and isinstance(pre, (int, float)) and pre > 0:
                # 盤前漲跌應對「上一個正規收盤價」(price)，而非更前一日的 prev_close
                base = data.get('price') or info.get('regularMarketPrice') or 0
                data['extended_price'] = float(pre)
                data['extended_type'] = 'PRE_MARKET'
                if base:
                    data['extended_change'] = float(pre) - base
                    data['extended_change_percent'] = (data['extended_change'] / base) * 100
        else:  # POST / POSTPOST / CLOSED
            post = info.get('postMarketPrice')
            if post and isinstance(post, (int, float)) and post > 0:
                regular = data.get('price') or info.get('regularMarketPrice') or 0
                data['extended_price'] = float(post)
                data['extended_type'] = 'POST_MARKET'
                if regular:
                    data['extended_change'] = float(post) - regular
                    data['extended_change_percent'] = (data['extended_change'] / regular) * 100
    except Exception as e:
        print(f"美股盤前/盤後補充失敗: {ticker} {e}")


async def get_logo_url(ticker: str) -> str | None:
    """provider 未提供 logo（台股/港股/陸股）時的後備來源。

    這些市場的代號無可靠的公司網域可查 favicon，目前回傳 None；
    前端 tileHtml 會自動以彩色字母圖示替代。
    """
    return None


# ── DB 同步操作：在 async endpoint 內以 asyncio.to_thread 呼叫，避免阻塞 event loop ──

_UPSERT_STOCK_SQL = """
    INSERT INTO stock_prices (
        ticker, price, prev_close, price_change, price_change_percent,
        company_name, logo_url, market_state, extended_price,
        extended_type, extended_change, extended_change_percent,
        updated_at
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
    ON CONFLICT (ticker) DO UPDATE SET
        price = EXCLUDED.price,
        prev_close = EXCLUDED.prev_close,
        price_change = EXCLUDED.price_change,
        price_change_percent = EXCLUDED.price_change_percent,
        company_name = EXCLUDED.company_name,
        logo_url = EXCLUDED.logo_url,
        market_state = EXCLUDED.market_state,
        extended_price = EXCLUDED.extended_price,
        extended_type = EXCLUDED.extended_type,
        extended_change = EXCLUDED.extended_change,
        extended_change_percent = EXCLUDED.extended_change_percent,
        updated_at = NOW();
"""


def _db_upsert_stock_price(data: dict) -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(_UPSERT_STOCK_SQL, (
            data['ticker'], data['price'], data['prev_close'],
            data['price_change'], data['price_change_percent'],
            data.get('company_name', ''), data.get('logo_url'),
            data.get('market_state', ''), data.get('extended_price'),
            data.get('extended_type'), data.get('extended_change'),
            data.get('extended_change_percent'),
        ))
        conn.commit()
    finally:
        cur.close()
        conn.close()


@router.get("/stockprice/{ticker}")
async def get_stock_price(ticker: str, _: str = Depends(current_user_email)):
    try:
        current_time = datetime.now()
        
        # 根據上次市場狀態動態調整快取時間
        if ticker in yahoo_cache:
            cache_data = yahoo_cache[ticker]
            time_diff = current_time - cache_data['timestamp']
            last_state = cache_data['data'].get('market_state', '')
            if last_state == 'REGULAR':
                cache_ttl = timedelta(seconds=4)  # <5s，配合前端 5 秒輪詢
            elif last_state in ('PRE', 'POST'):
                cache_ttl = timedelta(seconds=12)  # <15s，配合前端盤前/盤後 15 秒輪詢
            else:
                cache_ttl = timedelta(minutes=5)
            if time_diff < cache_ttl:
                return cache_data['data']
        
        # 嘗試透過專用 provider 取得資料（Finnhub / TWSE），失敗則 fallback 到 yfinance
        response_data = None
        ticker_upper = ticker.upper()

        if ticker_upper.endswith('.TW') or ticker_upper.endswith('.TWO'):
            # 台股 → 先試 TWSE
            print(f"嘗試 TWSE 取得報價: {ticker}")
            response_data = await fetch_twse_quote(ticker)
            if response_data:
                print(f"TWSE 取得報價成功: {ticker}")
        elif ticker_upper.endswith('.HK') or ticker_upper.endswith('.SS') or ticker_upper.endswith('.SZ'):
            # 港股 / A 股 → 先試新浪財經
            print(f"嘗試 AStock 取得報價: {ticker}")
            response_data = await fetch_astock_quote(ticker)
            if response_data:
                print(f"AStock 取得報價成功: {ticker}")
        elif '.' not in ticker and settings.FINNHUB_API_KEY:
            # 美股（無後綴）→ 先試 Finnhub
            print(f"嘗試 Finnhub 取得報價: {ticker}")
            response_data = await fetch_finnhub_quote(ticker, settings.FINNHUB_API_KEY)
            if response_data:
                print(f"Finnhub 取得報價成功: {ticker}")

        # 美股經 Finnhub 取得時無盤前/盤後資料，於非交易時段補打 yfinance 取得
        if (response_data is not None
                and '.' not in ticker
                and response_data.get('market_state') not in ('REGULAR', '')
                and not response_data.get('extended_price')):
            await _supplement_us_extended(ticker, response_data)

        # 如果 provider 未取得資料，fallback 到 yfinance
        if response_data is None:
            print(f"使用 yfinance 取得報價: {ticker}")
            info = await asyncio.to_thread(lambda: yf.Ticker(ticker).info)

            if info:
                current_price = info.get('regularMarketPrice', 0)
                prev_close = info.get('previousClose', 0)
                price_change = info.get('regularMarketChange', 0)
                price_change_percent = info.get('regularMarketChangePercent', 0)

                # 嘗試從不同可能的欄位獲取 logo URL（Clearbit 已停服，不再作為備源）
                logo_url = info.get('logo_url') or info.get('logoUrl')

                company_name = info.get('longName', '') or info.get('shortName', '')

                # 獲取市場狀態和交易價格
                market_state = info.get('marketState', '')
                extended_price = None
                extended_type = None
                extended_change = None
                extended_change_percent = None

                # 處理盤前交易（漲跌對上一個正規收盤價 current_price，非更前一日 prev_close）
                if market_state == 'PRE':
                    if 'preMarketPrice' in info and info['preMarketPrice']:
                        extended_price = float(info['preMarketPrice'])
                        extended_type = 'PRE_MARKET'
                        if current_price and extended_price:
                            extended_change = extended_price - current_price
                            extended_change_percent = (extended_change / current_price) * 100

                # 處理盤後交易（包括已收盤狀態）
                elif market_state in ['POST', 'POSTPOST', 'CLOSED']:
                    post_price = info.get('postMarketPrice')
                    if post_price and isinstance(post_price, (int, float)) and post_price > 0:
                        extended_price = float(post_price)
                        extended_type = 'POST_MARKET'
                        if current_price and extended_price:
                            extended_change = extended_price - current_price
                            extended_change_percent = (extended_change / current_price) * 100

                # 準備回傳資料
                response_data = {
                    'ticker': ticker,
                    'price': current_price,
                    'prev_close': prev_close,
                    'price_change': price_change,
                    'price_change_percent': price_change_percent,
                    'company_name': company_name,
                    'logo_url': logo_url,
                    'market_state': market_state,
                    'extended_price': extended_price,
                    'extended_type': extended_type,
                    'extended_change': extended_change,
                    'extended_change_percent': extended_change_percent
                }

        # 如果所有來源都未取得資料
        if response_data is None:
            return {
                'error': '無法獲取股票資訊',
                'ticker': ticker
            }

        # 若 provider 未提供 logo（台股/港股/陸股），用 Google favicon 補上
        if not response_data.get('logo_url'):
            response_data['logo_url'] = await get_logo_url(ticker)

        # 更新快取
        yahoo_cache[ticker] = {
            'timestamp': current_time,
            'data': response_data
        }

        # 檢查是否需要更新資料庫
        should_update_db = True
        if ticker in last_upsert_times:
            time_diff = current_time - last_upsert_times[ticker]
            if time_diff < timedelta(minutes=10):
                should_update_db = False

        # 如果需要更新資料庫
        if should_update_db:
            try:
                await asyncio.to_thread(_db_upsert_stock_price, response_data)
                last_upsert_times[ticker] = current_time
            except Exception as db_error:
                print(f"資料庫更新錯誤: {str(db_error)}")

        return response_data
    except Exception as e:
        return {
            'error': str(e),
            'ticker': ticker
        }

def _yf_ticker(ticker: str) -> str:
    """正規化代號供 yfinance 使用：港股需 4 位數代碼（去多餘前導零、補滿 4 位）。
    例：01810.HK -> 1810.HK、00700.HK -> 0700.HK。其他市場原樣回傳。"""
    if ticker.upper().endswith(".HK"):
        code = ticker[:-3]
        try:
            return str(int(code)).zfill(4) + ".HK"
        except ValueError:
            return ticker
    return ticker


@router.get("/sparkline/{ticker}")
async def get_sparkline(ticker: str, _: str = Depends(current_user_email)):
    """回傳近一個月日收盤序列，供前端畫迷你走勢圖。全市場通用，快取 30 分鐘。"""
    try:
        now = datetime.now()
        if ticker in sparkline_cache:
            ts, cached = sparkline_cache[ticker]
            if now - ts < timedelta(minutes=30):
                return cached

        hist = await asyncio.to_thread(lambda: yf.Ticker(_yf_ticker(ticker)).history(period="1mo", interval="1d"))
        closes = [round(float(c), 4) for c in hist["Close"].dropna().tolist()][-30:]
        data = {"ticker": ticker, "points": closes}
        if closes:  # 只快取成功結果；空的（多半是併發被限流）不快取以便重試
            sparkline_cache[ticker] = (now, data)
        return data
    except Exception as e:
        print(f"sparkline 取得失敗: {ticker} {e}")
        return {"ticker": ticker, "points": []}


_RANGE_MAP = {
    "24h": ("1d", "5m"),
    "5d":  ("5d", "15m"),
    "1m":  ("1mo", "1d"),
    "3m":  ("3mo", "1d"),
    "1y":  ("1y", "1d"),
    "5y":  ("5y", "1wk"),
    "max": ("max", "1mo"),
}


def _compute_history(ticker_yf: str, period: str, interval: str) -> dict:
    """在 worker thread 執行：拉歷史 OHLCV、算 MA 和 max drawdown。"""
    hist = yf.Ticker(ticker_yf).history(period=period, interval=interval)
    if hist.empty:
        return {"dates": [], "close": [], "volume": [], "ma20": [], "ma60": [], "ma120": [], "bb_upper": [], "bb_lower": [], "mdd": None}

    import math
    hist = hist.dropna(subset=["Close"])
    if hist.empty:
        return {"dates": [], "close": [], "volume": [], "ma20": [], "ma60": [], "ma120": [], "bb_upper": [], "bb_lower": [], "mdd": None}

    dates = [d.strftime("%Y-%m-%d %H:%M") if interval in ("5m", "15m") else d.strftime("%Y-%m-%d")
             for d in hist.index]
    close = [round(float(c), 4) for c in hist["Close"]]
    volume = [int(v) if not math.isnan(v) else 0 for v in hist["Volume"]]

    ma20 = _ma_list(close, 20)
    ma60 = _ma_list(close, 60)
    ma120 = _ma_list(close, 120)
    bb_upper, bb_lower = _bollinger_bands(close, 20, 2)

    peak = 0.0
    mdd = 0.0
    for c in close:
        if c > peak:
            peak = c
        if peak > 0:
            dd = (c - peak) / peak
            if dd < mdd:
                mdd = dd
    mdd = round(mdd * 100, 2)

    hi = max(close)
    lo = min(close)
    avg = round(sum(close) / len(close), 4)

    return {
        "dates": dates, "close": close, "volume": volume,
        "ma20": ma20, "ma60": ma60, "ma120": ma120,
        "bb_upper": bb_upper, "bb_lower": bb_lower,
        "mdd": mdd, "high": hi, "low": lo, "avg": avg,
    }


def _ma_list(close: list, window: int) -> list:
    n = len(close)
    if n < window:
        return [None] * n
    result = [None] * (window - 1)
    s = sum(close[:window])
    result.append(round(s / window, 4))
    for i in range(window, n):
        s += close[i] - close[i - window]
        result.append(round(s / window, 4))
    return result


def _bollinger_bands(close: list, window: int = 20, num_std: int = 2) -> tuple[list, list]:
    """純 Python 計算布林通道上下軌。"""
    import math
    n = len(close)
    upper = [None] * n
    lower = [None] * n
    if n < window:
        return upper, lower
    for i in range(window - 1, n):
        seg = close[i - window + 1: i + 1]
        mean = sum(seg) / window
        variance = sum((x - mean) ** 2 for x in seg) / window
        std = math.sqrt(variance)
        upper[i] = round(mean + num_std * std, 4)
        lower[i] = round(mean - num_std * std, 4)
    return upper, lower


@router.get("/history/{ticker}")
async def get_history(ticker: str, range: str = "3m", _: str = Depends(current_user_email)):
    """回傳歷史 OHLCV + MA20/60/120 + Max Drawdown，供前端畫走勢圖。快取 30 分鐘。"""
    if range not in _RANGE_MAP:
        range = "3m"
    cache_key = f"{ticker}:{range}"
    now = datetime.now()
    if cache_key in history_cache:
        ts, cached = history_cache[cache_key]
        if now - ts < timedelta(minutes=30):
            return cached
    try:
        period, interval = _RANGE_MAP[range]
        data = await asyncio.to_thread(_compute_history, _yf_ticker(ticker), period, interval)
        result = {"ticker": ticker, "range": range, **data}
        if data["close"]:
            history_cache[cache_key] = (now, result)
        return result
    except Exception as e:
        print(f"history 取得失敗: {ticker} {e}")
        return {"ticker": ticker, "range": range, "error": str(e)}


@router.get("/fundamentals/{ticker}")
async def get_fundamentals(ticker: str, _: str = Depends(current_user_email)):
    """回傳基本面指標供股票列展開時顯示。全市場通用，快取 6 小時。缺值回 null。"""
    try:
        now = datetime.now()
        if ticker in fundamentals_cache:
            ts, cached = fundamentals_cache[ticker]
            if now - ts < timedelta(hours=6):
                return cached

        info = await asyncio.to_thread(lambda: yf.Ticker(_yf_ticker(ticker)).info) or {}
        # ADR/外國股票的股價幣別與財報幣別不同時（如 TSM: USD/TWD），
        # Yahoo 的 P/B、P/S 是跨幣別誤除的錯值（TSM P/B 會變 87）——寧缺勿錯，回 null
        cur, fin_cur = info.get("currency"), info.get("financialCurrency")
        mixed_ccy = bool(cur and fin_cur and cur != fin_cur)
        data = {
            "ticker": ticker,
            "pe": info.get("trailingPE"),
            "pb": None if mixed_ccy else info.get("priceToBook"),
            "ps": None if mixed_ccy else info.get("priceToSalesTrailing12Months"),
            "eps": info.get("trailingEps"),
            "dividend": info.get("dividendRate"),
            "divYield": info.get("dividendYield"),
            "week52High": info.get("fiftyTwoWeekHigh"),
            "week52Low": info.get("fiftyTwoWeekLow"),
        }
        fundamentals_cache[ticker] = (now, data)
        return data
    except Exception as e:
        print(f"基本面取得失敗: {ticker} {e}")
        return {"ticker": ticker, "error": str(e)}


@router.get("/stock/{ticker}")
async def get_stock(ticker: str, _: str = Depends(current_user_email)):
    try:
        info = await asyncio.to_thread(lambda: yf.Ticker(ticker).info)

        if info:
            current_price = info.get('regularMarketPrice', 0)
            prev_close = info.get('previousClose', 0)
            price_change = info.get('regularMarketChange', 0)
            price_change_percent = info.get('regularMarketChangePercent', 0)
            market_state = info.get('marketState', 'REGULAR')
            
            # 獲取盤前/盤後資料
            extended_price = None
            extended_type = None
            extended_change = None
            extended_change_percent = None
            
            # 盤前交易（漲跌對上一個正規收盤價 current_price）
            if market_state == 'PRE' and 'preMarketPrice' in info:
                extended_price = float(info['preMarketPrice'])
                extended_type = 'PRE_MARKET'
                if current_price:
                    extended_change = extended_price - current_price
                    extended_change_percent = (extended_change / current_price) * 100
            
            # 盤後交易（包括 CLOSED 狀態）
            elif (market_state in ['POST', 'POSTPOST', 'CLOSED']) and 'postMarketPrice' in info:
                post_price = info['postMarketPrice']
                if post_price and isinstance(post_price, (int, float)) and post_price > 0:
                    extended_price = float(post_price)
                    extended_type = 'AFTER_HOURS'
                    if current_price:
                        extended_change = extended_price - current_price
                        extended_change_percent = (extended_change / current_price) * 100
            
            return {
                'ticker': ticker,
                'price': current_price,
                'prev_close': prev_close,
                'price_change': price_change,
                'price_change_percent': price_change_percent,
                'market_state': market_state,
                'extended_price': extended_price,
                'extended_type': extended_type,
                'extended_change': extended_change,
                'extended_change_percent': extended_change_percent
            }
        return {
            'error': '無法獲取股票資訊',
            'ticker': ticker
        }
    except Exception as e:
        return {
            'error': str(e),
            'ticker': ticker
        }

# 主要外匯貨幣對（靜態清單，搜尋時優先比對）
_FOREX_PAIRS = [
    ("USDTWD=X", "USD/TWD", "美元/新台幣"),
    ("USDJPY=X", "USD/JPY", "美元/日圓"),
    ("EURUSD=X", "EUR/USD", "歐元/美元"),
    ("GBPUSD=X", "GBP/USD", "英鎊/美元"),
    ("USDCNY=X", "USD/CNY", "美元/人民幣"),
    ("USDHKD=X", "USD/HKD", "美元/港幣"),
    ("AUDUSD=X", "AUD/USD", "澳幣/美元"),
    ("NZDUSD=X", "NZD/USD", "紐幣/美元"),
    ("USDCAD=X", "USD/CAD", "美元/加幣"),
    ("USDCHF=X", "USD/CHF", "美元/瑞郎"),
    ("EURGBP=X", "EUR/GBP", "歐元/英鎊"),
    ("EURJPY=X", "EUR/JPY", "歐元/日圓"),
    ("GBPJPY=X", "GBP/JPY", "英鎊/日圓"),
    ("USDSGD=X", "USD/SGD", "美元/新加坡幣"),
    ("USDKRW=X", "USD/KRW", "美元/韓元"),
    ("USDINR=X", "USD/INR", "美元/印度盧比"),
    ("USDTHB=X", "USD/THB", "美元/泰銖"),
    ("USDMXN=X", "USD/MXN", "美元/墨西哥披索"),
    ("EURCHF=X", "EUR/CHF", "歐元/瑞郎"),
    ("EURCNY=X", "EUR/CNY", "歐元/人民幣"),
]

# Yahoo 內部交易所代碼 → 使用者看得懂的名稱（查無對應時顯示原代碼）
_EXCHANGE_NAMES = {
    "NMS": "NASDAQ", "NGM": "NASDAQ", "NCM": "NASDAQ", "NYQ": "NYSE",
    "ASE": "NYSE American", "PCX": "NYSE Arca", "BTS": "BATS",
    "TAI": "台灣證交所", "TWO": "櫃買中心", "HKG": "港交所",
    "SHH": "上海證交所", "SHZ": "深圳證交所",
    "GER": "德國 XETRA", "FRA": "法蘭克福", "LSE": "倫敦", "TYO": "東京",
}


def _search_forex(query: str) -> list[dict]:
    """比對靜態外匯清單，回傳符合的結果。"""
    q = query.upper().replace("/", "").replace("=X", "")
    matches = []
    for symbol, pair_name, cn_name in _FOREX_PAIRS:
        key = symbol.replace("=X", "")
        if q in key or q in pair_name.upper().replace("/", "") or q in cn_name:
            matches.append({
                'symbol': symbol,
                'name': f"{pair_name} {cn_name}",
                'exchange': 'FX',
                'display': f"{symbol} - {pair_name} {cn_name} (外匯)"
            })
    return matches


@router.get("/autocomplete/{query}")
async def autocomplete(query: str, _: str = Depends(current_user_email)):
    try:
        # 先比對靜態外匯清單
        forex_hits = _search_forex(query)

        # 使用 yahooquery 搜尋股票
        search = await asyncio.to_thread(yq.search, query)

        # 過濾並格式化結果
        stock_results = []
        if search and 'quotes' in search:
            for quote in search['quotes']:
                if quote.get('quoteType') in ['EQUITY', 'ETF']:
                    symbol = quote.get('symbol', '')
                    short_name = quote.get('shortname', '') or quote.get('longname', '')
                    exchange = quote.get('exchange', '')
                    if not (symbol and short_name):
                        continue
                    display = f"{symbol} - {short_name}"
                    if exchange:
                        display += f" ({_EXCHANGE_NAMES.get(exchange, exchange)})"
                    stock_results.append({
                        'symbol': symbol,
                        'name': short_name,
                        'exchange': exchange,
                        'display': display
                    })

        # 外匯優先，合併後限制數量
        seen = {r['symbol'] for r in forex_hits}
        combined = forex_hits + [r for r in stock_results if r['symbol'] not in seen]
        return combined[:10]

    except Exception as e:
        print(f"搜尋時發生錯誤: {str(e)}")
        return []

# ── AI 股票摘要 ──────────────────────────────────────────────────────────────

import aiohttp


def _db_fetch_summary(ticker: str) -> dict | None:
    """讀取 stock_summaries 中的快取摘要，回 dict 或 None。"""
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT ticker, summary, generated_at FROM stock_summaries WHERE ticker = %s",
            (ticker,),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def _db_upsert_summary(ticker: str, summary: str) -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO stock_summaries (ticker, summary, generated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (ticker) DO UPDATE SET
                   summary = EXCLUDED.summary,
                   generated_at = NOW();""",
            (ticker, summary),
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def _db_distinct_watchlist_tickers() -> list:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT DISTINCT ticker FROM watchlist_stocks")
        return [row[0] for row in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


async def _collect_us_context(ticker: str) -> str:
    """美股：Finnhub 近 30 天公司新聞 headline + 最新一季財報 EPS。"""
    parts = []
    base_url = "https://finnhub.io/api/v1"
    token = settings.FINNHUB_API_KEY
    to_date = datetime.now()
    from_date = to_date - timedelta(days=30)
    try:
        async with aiohttp.ClientSession() as session:
            # 公司新聞
            try:
                async with session.get(
                    f"{base_url}/company-news",
                    params={
                        "symbol": ticker,
                        "from": from_date.strftime("%Y-%m-%d"),
                        "to": to_date.strftime("%Y-%m-%d"),
                        "token": token,
                    },
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:
                    if resp.status == 200:
                        news = await resp.json()
                        headlines = [n.get("headline", "") for n in (news or [])[:15] if n.get("headline")]
                        if headlines:
                            parts.append("近期新聞標題：\n" + "\n".join(f"- {h}" for h in headlines))
            except Exception as e:
                print(f"Finnhub 新聞取得失敗: {ticker} {e}")

            # 財報 EPS
            try:
                async with session.get(
                    f"{base_url}/stock/earnings",
                    params={"symbol": ticker, "token": token},
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:
                    if resp.status == 200:
                        earnings = await resp.json()
                        if earnings:
                            e = earnings[0]
                            parts.append(
                                "最新一季財報（EPS）："
                                f"實際 {e.get('actual')}、預估 {e.get('estimate')}、"
                                f"驚奇 {e.get('surprise')}（期別 {e.get('period')}）"
                            )
            except Exception as e:
                print(f"Finnhub 財報取得失敗: {ticker} {e}")
    except Exception as e:
        print(f"Finnhub 資料蒐集異常: {ticker} {e}")
    return "\n\n".join(parts)


def _collect_fx_context_sync(ticker: str) -> str:
    """外匯：嘗試直接取新聞，取不到時用 quote 貨幣（如 TWD=X）撈。"""
    titles = []

    def _extract_titles(news_list):
        out = []
        for n in (news_list or [])[:10]:
            t = n.get("title") or (n.get("content") or {}).get("title")
            if t:
                out.append(t)
        return out

    try:
        titles = _extract_titles(yf.Ticker(ticker).news)
    except Exception:
        pass

    if not titles:
        # fallback: 用 quote 貨幣取新聞（USDTWD=X → TWD=X）
        raw = ticker.upper().replace("=X", "")
        if len(raw) == 6:
            quote_sym = raw[3:] + "=X"
            try:
                titles = _extract_titles(yf.Ticker(quote_sym).news)
            except Exception:
                pass

    if titles:
        return "近期新聞標題：\n" + "\n".join(f"- {x}" for x in titles)
    return ""


def _collect_non_us_context_sync(ticker: str) -> str:
    """非美股：yfinance 新聞 title + 最新季度財務。於 to_thread 內執行（阻塞）。"""
    parts = []
    yf_ticker = _yf_ticker(ticker)
    t = yf.Ticker(yf_ticker)

    # 新聞
    try:
        news = t.news or []
        titles = []
        for n in news[:10]:
            # yfinance 新聞結構可能為 {'title': ...} 或 {'content': {'title': ...}}
            title = n.get("title") or (n.get("content") or {}).get("title")
            if title:
                titles.append(title)
        if titles:
            parts.append("近期新聞標題：\n" + "\n".join(f"- {x}" for x in titles))
    except Exception as e:
        print(f"yfinance 新聞取得失敗: {ticker} {e}")

    # 財務：最新季度營收/淨利，退而求其次用 info 的 EPS
    try:
        fin = t.quarterly_financials
        added = False
        if fin is not None and not fin.empty:
            col = fin.columns[0]
            rev = fin.loc["Total Revenue", col] if "Total Revenue" in fin.index else None
            ni = fin.loc["Net Income", col] if "Net Income" in fin.index else None
            bits = []
            if rev is not None:
                bits.append(f"營收 {rev}")
            if ni is not None:
                bits.append(f"淨利 {ni}")
            if bits:
                parts.append(f"最新季度財務（{col})：" + "、".join(bits))
                added = True
        if not added:
            info = t.info or {}
            eps = info.get("trailingEps")
            if eps is not None:
                parts.append(f"EPS（trailing）：{eps}")
    except Exception as e:
        print(f"yfinance 財務取得失敗: {ticker} {e}")

    return "\n\n".join(parts)


async def _call_deepseek_summary(ticker: str, context_text: str, *, is_fx: bool = False) -> str:
    """呼叫 DeepSeek 產生 200 字以內繁中摘要。沿用 chat.py 的呼叫方式。"""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
    }
    if is_fx:
        system_prompt = (
            "你是專業的外匯分析師。請根據提供的新聞資料，為這個貨幣對產生一段繁體中文摘要，"
            "聚焦於：近期匯率走勢、影響匯率的經濟事件與央行政策、短期展望。"
            "語氣客觀中立，不做投資建議。"
            "嚴格限制在 200 字以內，且務必是完整的句子、不可在句子中途結束。"
        )
    else:
        system_prompt = (
            "你是專業的證券分析師。請根據提供的財報與新聞資料，為這支股票產生一段繁體中文摘要，"
            "聚焦於：財報表現、近期新聞題材、對股價的潛在影響。語氣客觀中立，不做投資建議。"
            "嚴格限制在 200 字以內，且務必是完整的句子、不可在句子中途結束。"
        )
    user_content = f"股票代號：{ticker}\n\n資料：\n{context_text}"
    data = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.7,
        "max_tokens": 600,
    }
    url = settings.DEEPSEEK_API_URL.rstrip("/")
    if not url.endswith("/chat/completions"):
        url += "/chat/completions"

    async with aiohttp.ClientSession() as session:
        async with session.post(
            url, headers=headers, json=data,
            timeout=aiohttp.ClientTimeout(total=60),
        ) as response:
            result = await response.json(content_type=None)
            if "choices" in result and len(result["choices"]) > 0:
                return result["choices"][0]["message"]["content"].strip()
    return ""


async def generate_stock_summary(ticker: str) -> str:
    """產生單支股票摘要（不含快取判斷）：蒐集資料→呼叫 DeepSeek→upsert。
    供端點與排程共用。回傳摘要字串；任何階段失敗時回空字串並印 log。"""
    try:
        is_fx = ticker.upper().endswith("=X")
        if is_fx:
            context_text = await asyncio.to_thread(_collect_fx_context_sync, ticker)
        elif '.' not in ticker and settings.FINNHUB_API_KEY:
            context_text = await _collect_us_context(ticker)
        else:
            context_text = await asyncio.to_thread(_collect_non_us_context_sync, ticker)

        if not context_text:
            context_text = "（無可用的新聞與財報資料）"

        summary = await _call_deepseek_summary(ticker, context_text, is_fx=is_fx)
        if summary:
            try:
                await asyncio.to_thread(_db_upsert_summary, ticker, summary)
            except Exception as e:
                print(f"摘要寫入資料庫失敗: {ticker} {e}")
        return summary
    except Exception as e:
        print(f"產生摘要失敗: {ticker} {e}")
        return ""


@router.get("/ai-summary/{ticker}")
async def get_ai_summary(ticker: str, refresh: bool = False, _: str = Depends(current_user_email)):
    """回傳 AI 股票摘要。25 小時內有快取則直接回，否則即時產生。refresh=true 強制重新產生。"""
    try:
        # 先看快取
        try:
            cached = await asyncio.to_thread(_db_fetch_summary, ticker)
        except Exception as e:
            print(f"讀取摘要快取失敗: {ticker} {e}")
            cached = None

        if cached and cached.get("summary") and cached.get("generated_at"):
            gen = cached["generated_at"]
            now = datetime.now(gen.tzinfo) if gen.tzinfo else datetime.now()
            age = now - gen

            if refresh and age < timedelta(hours=1):
                return {
                    "ticker": ticker,
                    "summary": cached["summary"],
                    "generated_at": gen.isoformat(),
                    "cooldown": True,
                }

            if not refresh and age < timedelta(hours=25):
                return {
                    "ticker": ticker,
                    "summary": cached["summary"],
                    "generated_at": gen.isoformat(),
                }

        # 即時產生
        summary = await generate_stock_summary(ticker)
        if not summary:
            return {"ticker": ticker, "summary": "", "error": "無法產生摘要"}

        return {
            "ticker": ticker,
            "summary": summary,
            "generated_at": datetime.now().isoformat(),
        }
    except Exception as e:
        print(f"ai-summary 端點異常: {ticker} {e}")
        return {"ticker": ticker, "summary": "", "error": str(e)}