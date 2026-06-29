from fastapi import APIRouter
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


def _supplement_us_extended(ticker: str, data: dict) -> None:
    """美股經 Finnhub 取得時補上盤前/盤後價（Finnhub 免費版無此資料）。

    直接修改傳入的 data。yfinance 在完全收盤時仍保留 postMarketPrice，
    會沿用至下次開盤，故不需另做持久化。失敗時靜默略過。
    """
    try:
        info = yf.Ticker(ticker).info or {}
        state = data.get('market_state', '')
        if state == 'PRE':
            pre = info.get('preMarketPrice')
            if pre and isinstance(pre, (int, float)) and pre > 0:
                prev_close = data.get('prev_close') or info.get('previousClose') or 0
                data['extended_price'] = float(pre)
                data['extended_type'] = 'PRE_MARKET'
                if prev_close:
                    data['extended_change'] = float(pre) - prev_close
                    data['extended_change_percent'] = (data['extended_change'] / prev_close) * 100
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
                cache_ttl = timedelta(seconds=15)
            elif last_state in ('PRE', 'POST'):
                cache_ttl = timedelta(seconds=60)
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
            _supplement_us_extended(ticker, response_data)

        # 如果 provider 未取得資料，fallback 到 yfinance
        if response_data is None:
            print(f"使用 yfinance 取得報價: {ticker}")
            stock = yf.Ticker(ticker)
            info = stock.info

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

                # 處理盤前交易
                if market_state == 'PRE':
                    if 'preMarketPrice' in info and info['preMarketPrice']:
                        extended_price = float(info['preMarketPrice'])
                        extended_type = 'PRE_MARKET'
                        if prev_close and extended_price:
                            extended_change = extended_price - prev_close
                            extended_change_percent = (extended_change / prev_close) * 100

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
                conn = get_db_connection()
                cur = conn.cursor()

                sql = """
                    INSERT INTO stock_prices (
                        ticker, price, prev_close, price_change, price_change_percent,
                        company_name, logo_url, market_state, extended_price,
                        extended_type, extended_change, extended_change_percent,
                        last_updated
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()
                    )
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

                cur.execute(sql, (
                    response_data['ticker'],
                    response_data['price'],
                    response_data['prev_close'],
                    response_data['price_change'],
                    response_data['price_change_percent'],
                    response_data.get('company_name', ''),
                    response_data.get('logo_url'),
                    response_data.get('market_state', ''),
                    response_data.get('extended_price'),
                    response_data.get('extended_type'),
                    response_data.get('extended_change'),
                    response_data.get('extended_change_percent')
                ))

                conn.commit()
                last_upsert_times[ticker] = current_time
            except Exception as db_error:
                print(f"資料庫更新錯誤: {str(db_error)}")
            finally:
                if 'cur' in locals():
                    cur.close()
                if 'conn' in locals():
                    conn.close()

        return response_data
    except Exception as e:
        return {
            'error': str(e),
            'ticker': ticker
        }

@router.get("/stock/{ticker}")
async def get_stock(ticker: str):
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        
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
            
            # 盤前交易
            if market_state == 'PRE' and 'preMarketPrice' in info:
                extended_price = float(info['preMarketPrice'])
                extended_type = 'PRE_MARKET'
                if prev_close:
                    extended_change = extended_price - prev_close
                    extended_change_percent = (extended_change / prev_close) * 100
            
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
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # 獲取用戶的自選股列表
        sql = """
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
        
        cur.execute(sql, (user_email,))
        stocks = cur.fetchall()
        
        return [dict(stock) for stock in stocks]
    except Exception as e:
        print(f"獲取自選股列表時發生錯誤: {str(e)}")
        return []
    finally:
        if 'cur' in locals():
            cur.close()
        if 'conn' in locals():
            conn.close()

@router.get("/autocomplete/{query}")
async def autocomplete(query: str):
    try:
        # 使用 yahooquery 搜尋股票
        search = yq.search(query)
        
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
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
            
        # 獲取目前最大的 display_order
        cur.execute("""
            SELECT COALESCE(MAX(display_order), 0) as max_order 
            FROM watchlist_stocks 
            WHERE user_email = %s
        """, (user_email,))
        max_order = cur.fetchone()['max_order']
        
        # 新增股票到 watchlist
        cur.execute("""
            INSERT INTO watchlist_stocks (
                user_email, 
                ticker, 
                display_order,
                created_at,
                updated_at
            )
            VALUES (%s, %s, %s, NOW(), NOW())
        """, (user_email, ticker, max_order + 1))
        
        conn.commit()
        return {"message": "成功新增股票到追蹤清單", "ticker": ticker}
        
    except Exception as e:
        return {"error": str(e)}
    finally:
        if 'cur' in locals():
            cur.close()
        if 'conn' in locals():
            conn.close()

@router.delete("/watchlist/{user_email}/{ticker}")
async def remove_from_watchlist(user_email: str, ticker: str):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 從 watchlist 中移除股票
        cur.execute("""
            DELETE FROM watchlist_stocks 
            WHERE user_email = %s AND ticker = %s
        """, (user_email, ticker))
        
        conn.commit()
        return {"message": "成功從追蹤清單移除股票", "ticker": ticker}
        
    except Exception as e:
        return {"error": str(e)}
    finally:
        if 'cur' in locals():
            cur.close()
        if 'conn' in locals():
            conn.close()

class ReorderRequest(BaseModel):
    user_email: str
    tickers: List[str]

@router.post("/watchlist/reorder")
async def reorder_watchlist(request: ReorderRequest):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 更新每個股票的顯示順序
        for index, ticker in enumerate(request.tickers):
            cur.execute("""
                UPDATE watchlist_stocks 
                SET display_order = %s,
                    updated_at = NOW()
                WHERE user_email = %s AND ticker = %s
            """, (index, request.user_email, ticker))
        
        conn.commit()
        return {"message": "成功更新股票順序"}
        
    except Exception as e:
        return {"error": str(e)}
    finally:
        if 'cur' in locals():
            cur.close()
        if 'conn' in locals():
            conn.close()