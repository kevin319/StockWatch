from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
from google.oauth2 import id_token
from google.auth.transport import requests
import os
import yahooquery as yq
from pydantic import BaseModel
from dotenv import load_dotenv  # 新增：讀取 .env 檔案

# 載入 .env 檔案
load_dotenv()

app = FastAPI()

# 設定 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 設定靜態文件
app.mount("/static", StaticFiles(directory="static"), name="static")

# Gemini API 配置（從環境變數讀取）
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY 未在 .env 檔案中設定")
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"

# Google OAuth 設定
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
if not GOOGLE_CLIENT_ID:
    raise ValueError("GOOGLE_CLIENT_ID 未在 .env 檔案中設定")

# 定義請求模型
class ChatRequest(BaseModel):
    message: str

@app.get("/")
async def read_root():
    return FileResponse("static/login.html")

@app.get("/home")
async def read_home():
    return FileResponse("static/index.html")

@app.get("/verify_token")
async def verify_token(token: str):
    try:
        # 驗證 Google Token
        idinfo = id_token.verify_oauth2_token(
            token, requests.Request(), GOOGLE_CLIENT_ID)

        if idinfo['aud'] != GOOGLE_CLIENT_ID:
            raise ValueError('錯誤的 Client ID')

        # 返回用戶資訊
        return {
            'valid': True,
            'email': idinfo['email'],
            'name': idinfo.get('name', ''),
            'picture': idinfo.get('picture', '')
        }
    except ValueError:
        raise HTTPException(status_code=401, detail="無效的 Token")

# 獲取股票價格
@app.get("/stockprice/{ticker}")
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
                    # 計算盤前漲跌幅（相對於前一天收盤價）
                    if prev_close and extended_price:
                        extended_change = extended_price - prev_close
                        extended_change_percent = (extended_change / prev_close) * 100
            elif market_state == 'POST' or market_state == 'POSTPOST':
                if 'postMarketPrice' in info and info['postMarketPrice']:
                    extended_price = float(info['postMarketPrice'])
                    extended_type = 'POST'
                    # 計算盤後漲跌幅（相對於當天收盤價）
                    if current_price and extended_price:
                        extended_change = extended_price - current_price
                        extended_change_percent = (extended_change / current_price) * 100
            
            # 調試輸出
            print(f"Stock info for {ticker}:")
            print(f"Market State: {market_state}")
            print(f"Extended Price: {extended_price}")
            print(f"Extended Change: {extended_change}")
            print(f"Extended Change %: {extended_change_percent}")
            
            return {
                'ticker': ticker, 
                'price': current_price,
                'prev_close': prev_close,
                'price_change': price_change,
                'price_change_percent': price_change_percent,
                'extended_price': extended_price,
                'extended_type': extended_type,
                'extended_change': extended_change,
                'extended_change_percent': extended_change_percent,
                'logo_url': logo_url,
                'company_name': company_name
            }
        else:
            return {
                'error': f'No data found for ticker: {ticker}',
                'ticker': ticker
            }
    except Exception as e:
        print(f"Error fetching stock price for {ticker}: {e}")
        return {
            'error': str(e),
            'ticker': ticker
        }

# 獲取股票數據（含歷史數據供圖表使用）
@app.get("/stock/{symbol}")
async def get_stock(symbol: str):
    stock = yf.Ticker(symbol)
    data = stock.history(period="1d", interval="5m")
    prices = [{"time": index.isoformat(), "price": row["Close"]} for index, row in data.iterrows()]
    latest = data.iloc[-1]
    return {
        "symbol": symbol,
        "latest_price": latest["Close"],
        "change": latest["Close"] - latest["Open"],
        "timestamp": data.index[-1].isoformat(),
        "history": prices
    }

# 自動完成建議（使用 yfinance 搜尋多市場股票）
@app.get("/autocomplete/{query}")
async def autocomplete(query: str):
    try:
        # 將查詢轉換為大寫，以提高搜尋準確性
        query = query.upper()
        
        # 記錄查詢日誌
        print(f"Autocomplete query: {query}")
        
        # 使用 yfinance 的 Ticker 方法搜尋股票
        suggestions = []
        
        # 嘗試直接搜尋股票代號
        try:
            stock = yf.Ticker(query)
            info = stock.info
            
            if info and 'symbol' in info:
                symbol = info.get('symbol', '')
                name = info.get('longName', '') or info.get('shortName', '')
                
                # 篩選條件：
                # 1. 符號不為空
                # 2. 包含常見市場：美股、台股、港股、中國股市
                if symbol and (
                    symbol.endswith(".TW") or  # 台灣股市
                    symbol.endswith(".HK") or  # 香港股市
                    symbol.endswith((".SS", ".SZ")) or  # 上海、深圳股市
                    not symbol.endswith((".O", ".N"))  # 其他市場，如納斯達克、紐約證券交易所
                ):
                    suggestions.append({
                        "name": name, 
                        "symbol": symbol
                    })
        except Exception as e:
            print(f"Direct symbol search error: {e}")
        
        # 如果直接搜尋失敗，嘗試使用模糊搜尋
        if not suggestions:
            # 使用 yfinance 下載市場數據作為搜尋基礎
            market_data = yf.download(query, period="1d")
            
            if not market_data.empty:
                symbol = market_data.index[0]
                stock = yf.Ticker(symbol)
                info = stock.info
                
                if info and 'symbol' in info:
                    name = info.get('longName', '') or info.get('shortName', '')
                    suggestions.append({
                        "name": name, 
                        "symbol": symbol
                    })
        
        # 記錄建議結果
        print(f"Suggestions: {suggestions}")
        
        # 返回前 5 個建議
        return {"suggestions": suggestions[:5]}
    
    except Exception as e:
        # 記錄詳細錯誤
        print(f"Autocomplete error: {e}")
        import traceback
        traceback.print_exc()
        return {"suggestions": [], "error": str(e)}

# 對話式 AI 查詢（使用 Gemini API）
@app.post("/chat")
async def chat(request: ChatRequest):
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
    }
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": f"你是金融科技助手，回答股票相關問題。\n用戶問題：{request.message}"
                    }
                ]
            }
        ]
    }
    response = requests.post(GEMINI_API_URL, json=payload, headers=headers)
    if response.status_code == 200:
        result = response.json()
        reply = result["candidates"][0]["content"]["parts"][0]["text"]
        return {"reply": reply}
    else:
        return {"reply": f"錯誤：無法連接到 Gemini API ({response.status_code})"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)