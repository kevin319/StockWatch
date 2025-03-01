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

# 設定安全性
security = HTTPBearer()

# 註冊路由
app.include_router(auth.router, tags=["auth"])
app.include_router(stock.router, prefix="/api/stock", tags=["stock"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
