from fastapi import APIRouter
import yfinance as yf
import yahooquery as yq

router = APIRouter()

@router.get("/stockprice/{ticker}")
async def get_stock_price(ticker: str):
    try:
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
            
            if market_state == 'PRE':
                if 'preMarketPrice' in info and info['preMarketPrice']:
                    extended_price = float(info['preMarketPrice'])
                    extended_type = 'PRE'
                    if prev_close and extended_price:
                        extended_change = extended_price - prev_close
                        extended_change_percent = (extended_change / prev_close) * 100
            elif market_state == 'POST' or market_state == 'POSTPOST':
                if 'postMarketPrice' in info and info['postMarketPrice']:
                    extended_price = float(info['postMarketPrice'])
                    extended_type = 'POST'
                    if current_price and extended_price:
                        extended_change = extended_price - current_price
                        extended_change_percent = (extended_change / current_price) * 100
            
            return {
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
        return {
            'error': '無法獲取股票資訊',
            'ticker': ticker
        }
    except Exception as e:
        return {
            'error': str(e),
            'ticker': ticker
        }

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
