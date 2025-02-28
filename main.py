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

# 自動完成建議（使用 yahooquery 搜尋多市場股票）
@app.get("/autocomplete/{query}")
async def autocomplete(query: str):
    try:
        search = yq.search(query, quotes=True, news=False, country="global")
        suggestions = []
        if "quotes" in search:
            for quote in search["quotes"]:
                symbol = quote.get("symbol", "")
                name = quote.get("shortname", "") or quote.get("longname", "")
                if symbol.endswith(".TW") or not symbol.endswith((".HK", ".SS", ".SZ", ".O", ".TW")) or symbol.endswith(".HK") or symbol.endswith(".SS") or symbol.endswith(".SZ"):
                    suggestions.append({"name": name, "symbol": symbol})
        return {"suggestions": suggestions[:5]}
    except Exception as e:
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