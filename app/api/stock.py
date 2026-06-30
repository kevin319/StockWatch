from fastapi import APIRouter
import asyncio
import yfinance as yf
import yahooquery as yq
from app.models.db import get_db_connection
from psycopg2.extras import RealDictCursor
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import List
from app.core.config import settings
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

# 基本面快取（變動更慢）
fundamentals_cache = {}


async def _supplement_us_extended(ticker: str, data: dict) -> None:
    """美股經 Finnhub 取得時補上盤前/盤後價（Finnhub 免費版無此資料）。

    直接修改傳入的 data。yfinance 在完全收盤時仍保留 postMarketPrice，
    會沿用至下次開盤，故不需另做持久化。失敗時靜默略過。
    """
    try:
        info = await asyncio.to_thread(lambda: yf.Ticker(ticker).info) or {}
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
        last_updated
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
        last_updated = NOW();
"""

_WATCHLIST_SQL = """
    SELECT
        ws.ticker,
        ws.display_order,
        COALESCE(sp.price, 0) as price,
        COALESCE(sp.prev_close, 0) as prev_close,
        COALESCE(sp.price_change, 0) as price_change,
        COALESCE(sp.price_change_percent, 0) as price_change_percent,
        COALESCE(sp.market_state, '') as market_state,
        COALESCE(sp.extended_price, 0) as extended_price,
        COALESCE(sp.extended_type, '') as extended_type,
        COALESCE(sp.extended_change, 0) as extended_change,
        COALESCE(sp.extended_change_percent, 0) as extended_change_percent
    FROM watchlist_stocks ws
    LEFT JOIN stock_prices sp ON ws.ticker = sp.ticker
    WHERE ws.user_email = %s
    ORDER BY ws.display_order;
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


def _db_fetch_watchlist(user_email: str) -> list:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(_WATCHLIST_SQL, (user_email,))
        return [dict(row) for row in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def _db_add_watchlist(user_email: str, ticker: str) -> None:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT COALESCE(MAX(display_order), 0) as max_order FROM watchlist_stocks WHERE user_email = %s",
            (user_email,),
        )
        max_order = cur.fetchone()['max_order']
        cur.execute(
            """INSERT INTO watchlist_stocks (user_email, ticker, display_order, created_at, updated_at)
               VALUES (%s, %s, %s, NOW(), NOW())""",
            (user_email, ticker, max_order + 1),
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def _db_remove_watchlist(user_email: str, ticker: str) -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "DELETE FROM watchlist_stocks WHERE user_email = %s AND ticker = %s",
            (user_email, ticker),
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def _db_reorder_watchlist(user_email: str, tickers: list) -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        for index, ticker in enumerate(tickers):
            cur.execute(
                "UPDATE watchlist_stocks SET display_order = %s, updated_at = NOW() WHERE user_email = %s AND ticker = %s",
                (index, user_email, ticker),
            )
        conn.commit()
    finally:
        cur.close()
        conn.close()


@router.get("/stockprice/{ticker}")
async def get_stock_price(ticker: str):
    try:
        current_time = datetime.now()
        
        # 根據上次市場狀態動態調整快取時間
        if ticker in yahoo_cache:
            cache_data = yahoo_cache[ticker]
            time_diff = current_time - cache_data['timestamp']
            last_state = cache_data['data'].get('market_state', '')
            if last_state == 'REGULAR':
                cache_ttl = timedelta(seconds=8)  # <10s，讓前端 10 秒輪詢每次都拿到新價
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

                # 嘗試從不同可能的欄位獲取 logo URL
                logo_url = None
                if 'logo_url' in info:
                    logo_url = info['logo_url']
                elif 'logoUrl' in info:
                    logo_url = info['logoUrl']
                elif 'website' in info:
                    domain = info['website'].replace('http://', '').replace('https://', '').split('/')[0]
                    logo_url = f'https://logo.clearbit.com/{domain}'

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
async def get_sparkline(ticker: str):
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


@router.get("/fundamentals/{ticker}")
async def get_fundamentals(ticker: str):
    """回傳基本面指標供股票列展開時顯示。全市場通用，快取 6 小時。缺值回 null。"""
    try:
        now = datetime.now()
        if ticker in fundamentals_cache:
            ts, cached = fundamentals_cache[ticker]
            if now - ts < timedelta(hours=6):
                return cached

        info = await asyncio.to_thread(lambda: yf.Ticker(_yf_ticker(ticker)).info) or {}
        data = {
            "ticker": ticker,
            "pe": info.get("trailingPE"),
            "pb": info.get("priceToBook"),
            "ps": info.get("priceToSalesTrailing12Months"),
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
async def get_stock(ticker: str):
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

@router.get("/watchlist/{user_email}")
async def get_watchlist(user_email: str):
    try:
        return await asyncio.to_thread(_db_fetch_watchlist, user_email)
    except Exception as e:
        print(f"獲取自選股列表時發生錯誤: {str(e)}")
        return []

@router.get("/autocomplete/{query}")
async def autocomplete(query: str):
    try:
        # 使用 yahooquery 搜尋股票
        search = await asyncio.to_thread(yq.search, query)
        
        # 檢查是否有搜尋結果
        if not search or 'quotes' not in search:
            return []
        
        # 過濾並格式化結果
        results = []
        for quote in search['quotes']:
            # 只包含股票和 ETF
            if quote.get('quoteType') in ['EQUITY', 'ETF']:
                # 構建顯示名稱
                symbol = quote.get('symbol', '')
                short_name = quote.get('shortname', '') or quote.get('longname', '')
                exchange = quote.get('exchange', '')
                
                # 如果沒有足夠信息則跳過
                if not (symbol and short_name):
                    continue
                
                # 格式化顯示名稱
                display = f"{symbol} - {short_name}"
                if exchange:
                    display += f" ({exchange})"
                
                results.append({
                    'symbol': symbol,
                    'name': short_name,
                    'exchange': exchange,
                    'display': display
                })
        
        # 限制返回結果數量
        return results[:10]
    
    except Exception as e:
        print(f"搜尋時發生錯誤: {str(e)}")
        return []

@router.post("/watchlist/add")
async def add_to_watchlist(ticker: str, user_email: str):
    try:
        await asyncio.to_thread(_db_add_watchlist, user_email, ticker)
        return {"message": "成功新增股票到追蹤清單", "ticker": ticker}
    except Exception as e:
        return {"error": str(e)}

@router.delete("/watchlist/{user_email}/{ticker}")
async def remove_from_watchlist(user_email: str, ticker: str):
    try:
        await asyncio.to_thread(_db_remove_watchlist, user_email, ticker)
        return {"message": "成功從追蹤清單移除股票", "ticker": ticker}
    except Exception as e:
        return {"error": str(e)}

class ReorderRequest(BaseModel):
    user_email: str
    tickers: List[str]

@router.post("/watchlist/reorder")
async def reorder_watchlist(request: ReorderRequest):
    try:
        await asyncio.to_thread(_db_reorder_watchlist, request.user_email, request.tickers)
        return {"message": "成功更新股票順序"}
    except Exception as e:
        return {"error": str(e)}