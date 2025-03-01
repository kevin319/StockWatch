from fastapi import APIRouter
import yfinance as yf
import yahooquery as yq
from app.models.db import get_db_connection
from psycopg2.extras import RealDictCursor
from datetime import datetime, timedelta

router = APIRouter()

# 記錄最後一次 upsert 的時間
last_upsert_times = {}

# 記錄 Yahoo Finance 的快取
yahoo_cache = {}

@router.get("/stockprice/{ticker}")
async def get_stock_price(ticker: str):
    try:
        current_time = datetime.now()
        
        # 檢查 Yahoo Finance 快取
        if ticker in yahoo_cache:
            cache_data = yahoo_cache[ticker]
            time_diff = current_time - cache_data['timestamp']
            
            if time_diff < timedelta(minutes=5):
                # 先獲取新資料但不儲存，用來比較
                stock = yf.Ticker(ticker)
                info = stock.info
                
                if info:
                    current_price = info.get('regularMarketPrice', 0)
                    prev_close = info.get('previousClose', 0)
                    price_change = info.get('regularMarketChange', 0)
                    price_change_percent = info.get('regularMarketChangePercent', 0)
                    market_state = info.get('marketState', '')
                    
                    # 檢查關鍵數據是否相同
                    cached_data = cache_data['data']
                    if (current_price == cached_data['price'] and 
                        prev_close == cached_data['prev_close'] and
                        price_change == cached_data['price_change'] and
                        price_change_percent == cached_data['price_change_percent'] and
                        market_state == cached_data['market_state']):
                        print(f"使用快取資料: {ticker}")
                        return cached_data
        
        # 如果沒有快取或快取已過期或資料有變化，從 Yahoo Finance 獲取新資料
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
            
            # 更新 Yahoo Finance 快取
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
                        ticker, current_price, prev_close, price_change, price_change_percent,
                        company_name, logo_url, market_state, extended_price,
                        extended_type, extended_change, extended_change_percent
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
        return {
            'error': '無法獲取股票資訊',
            'ticker': ticker
        }
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