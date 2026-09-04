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
from app.models.backup import run_backup
from app.models.migrations import ensure_watchlist_groups, ensure_watchlist_subgroups, ensure_group_stocks_m2m

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


async def _daily_backup() -> None:
    """排程工作：每日資料庫備份。"""
    import asyncio
    try:
        await asyncio.to_thread(run_backup)
    except Exception as e:
        logger.error(f"每日備份失敗: {e}")


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

    try:
        await asyncio.to_thread(ensure_watchlist_subgroups)
    except Exception as e:
        logger.error(f"watchlist subgroups 遷移失敗: {e}")

    try:
        await asyncio.to_thread(ensure_group_stocks_m2m)
    except Exception as e:
        logger.error(f"group_stocks m2m 遷移失敗: {e}")

    # 啟動時先備份一次：確保隨時都有一份近期備份，設定錯誤也會立刻在 log 曝光
    try:
        await asyncio.to_thread(run_backup)
    except Exception as e:
        logger.error(f"啟動時備份失敗: {e}")

    # 啟動排程（失敗不可讓 app 崩潰）
    try:
        scheduler.add_job(
            _refresh_all_summaries,
            CronTrigger(hour=7, minute=0, timezone="Asia/Taipei"),
            id="daily_stock_summaries",
            replace_existing=True,
        )
        scheduler.add_job(
            _daily_backup,
            CronTrigger(hour=3, minute=0, timezone="Asia/Taipei"),
            id="daily_backup",
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


def _compute_asset_version() -> str:
    """以前端靜態檔內容算出版本雜湊，供前端偵測自己是不是舊版。

    容器內的檔案在執行期不會變，啟動時算一次即可。手動維護版號容易忘記，
    改用內容雜湊就不會有「改了程式卻忘了改版號」的問題。
    """
    import hashlib
    h = hashlib.sha256()
    for name in ("static/index.html", "static/main.js", "static/watchlists.js"):
        try:
            with open(name, "rb") as f:
                h.update(f.read())
        except OSError as e:
            logger.error(f"計算資產版本時讀不到 {name}: {e}")
    return h.hexdigest()[:12]


ASSET_VERSION = _compute_asset_version()


@app.get("/health")
async def health_check():
    """公開端點：供 Docker / 負載均衡器探測服務是否正常。"""
    import asyncio
    try:
        await asyncio.to_thread(_check_db)
        db_ok = True
    except Exception:
        db_ok = False
    status = "healthy" if db_ok else "degraded"
    code = 200 if db_ok else 503
    from fastapi.responses import JSONResponse
    return JSONResponse({"status": status, "db": db_ok}, status_code=code)


def _check_db() -> None:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
    finally:
        conn.close()


@app.get("/version")
async def get_version():
    """公開端點（不需登入）：前端用來比對自己載入的是不是最新版前端。"""
    return {"version": ASSET_VERSION}


# 註冊路由
app.include_router(auth.router, tags=["auth"])
app.include_router(stock.router, tags=["stock"])
app.include_router(watchlists.router, tags=["watchlists"])
if AI_CHAT_ENABLED:
    app.include_router(chat.router, tags=["chat"])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
