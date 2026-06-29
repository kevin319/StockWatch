from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
from app.api import auth, stock, chat

app = FastAPI()

# 設定 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# 設定靜態文件
app.mount("/static", StaticFiles(directory="static", check_dir=False), name="static")


# 靜態檔與頁面加 no-cache：瀏覽器每次以 etag 向伺服器驗證，避免快取到舊版前端
@app.middleware("http")
async def add_no_cache_header(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static") or request.url.path in ("/", "/home"):
        response.headers["Cache-Control"] = "no-cache"
    return response


# 設定安全性
security = HTTPBearer()

# 註冊路由
app.include_router(auth.router, tags=["auth"])
app.include_router(stock.router, tags=["stock"])
app.include_router(chat.router, tags=["chat"])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
