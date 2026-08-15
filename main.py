import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.api import auth, stock, chat, watchlists
from app.models.db import get_db_connection
from app.models.migrations import ensure_watchlist_groups

logger = logging.getLogger(__name__)

# AI 對話暫不開放。整個 router 不註冊，端點才不會出現在公開的 /openapi.json 與 /docs；
# 只在 handler 內擋是不夠的，路徑名稱仍會被列出來。
# 要恢復請一併把 static/main.js 的 AI_CHAT_ENABLED 也改回 true。
AI_CHAT_ENABLED = False


def _ensure_summary_table() -> None:
    """建立 stock_summaries 表（idempotent）。同步操作，於 to_thread 內呼叫。"""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """CREATE TABLE IF NOT EXISTS stock_summaries (
                   ticker TEXT PRIMARY KEY,
                   summary TEXT,
                   generated_at TIMESTAMPTZ DEFAULT NOW()
               );"""
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


async def _refresh_all_summaries() -> None:
    """排程工作：對所有自選股逐支重新產生摘要並 upsert（序列）。"""
    import asyncio
    try:
        tickers = await asyncio.to_thread(stock._db_distinct_watchlist_tickers)
    except Exception as e:
        logger.error(f"排程取得自選股清單失敗: {e}")
        return
    for ticker in tickers:
        try:
            await stock.generate_stock_summary(ticker)
        except Exception as e:
            logger.error(f"排程產生摘要失敗: {ticker} {e}")


scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    # 建表（失敗不可讓 app 崩潰）
    try:
        await asyncio.to_thread(_ensure_summary_table)
    except Exception as e:
        logger.error(f"建立 stock_summaries 表失敗: {e}")

    # 清單分組遷移（失敗不可讓 app 崩潰）
    try:
        await asyncio.to_thread(ensure_watchlist_groups)
    except Exception as e:
        logger.error(f"watchlist groups 遷移失敗: {e}")

    # 啟動排程（失敗不可讓 app 崩潰）
    try:
        scheduler.add_job(
            _refresh_all_summaries,
            CronTrigger(hour=7, minute=0, timezone="Asia/Taipei"),
            id="daily_stock_summaries",
            replace_existing=True,
        )
        scheduler.start()
    except Exception as e:
        logger.error(f"啟動排程失敗: {e}")

    yield

    try:
        scheduler.shutdown(wait=False)
    except Exception as e:
        logger.error(f"關閉排程失敗: {e}")


app = FastAPI(lifespan=lifespan)

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
app.include_router(watchlists.router, tags=["watchlists"])
if AI_CHAT_ENABLED:
    app.include_router(chat.router, tags=["chat"])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
