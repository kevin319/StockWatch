from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import yfinance as yf
import requests
from pydantic import BaseModel
import yahooquery as yq
from dotenv import load_dotenv  # 新增：讀取 .env 檔案
import os

# 載入 .env 檔案
load_dotenv()

app = FastAPI()

# 掛載靜態檔案目錄
app.mount("/static", StaticFiles(directory="static"), name="static")

# Gemini API 配置（從環境變數讀取）
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY 未在 .env 檔案中設定")
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"

# 定義請求模型
class ChatRequest(BaseModel):
    message: str

# 獲取股票價格
@app.get('/stockprice/<ticker>')
def get_stock_price(ticker):
    stock = yf.Ticker(ticker)
    data = stock.history(period='1d')
    if not data.empty:
        price = data['Close'].iloc[-1]
        premarket = stock.info.get('preMarketPrice', 'N/A')
        return jsonify({'ticker': ticker, 'price': price, 'premarket': premarket})
    else:
        return jsonify({'error': 'No data found for ticker: {}'.format(ticker)}), 404    

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

# 新增根路由，直接回傳 index.html
@app.get("/")
async def serve_index():
    return FileResponse("static/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)