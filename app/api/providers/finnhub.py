import aiohttp
from datetime import datetime
from zoneinfo import ZoneInfo

# 快取公司名稱和 logo（很少變動，節省 API 呼叫）
_company_cache = {}

# 使用 IANA 時區，自動處理夏令/冬令（原本寫死 -4 會在冬令時錯 1 小時）
_ET = ZoneInfo("America/New_York")

def _us_market_state() -> str:
    """根據美東時間判斷美股市場狀態。
    收盤邊界加 3 分鐘緩衝，避免 Docker 時鐘偏差提前判定 POST。"""
    now = datetime.now(_ET)
    if now.weekday() >= 5:
        return "CLOSED"
    t = now.hour * 60 + now.minute
    if 570 <= t < 963:     # 9:30-16:03（含 3 分鐘緩衝）
        return "REGULAR"
    if 240 <= t < 570:     # 4:00-9:30
        return "PRE"
    if 963 <= t < 1200:    # 16:03-20:00
        return "POST"
    return "CLOSED"


async def fetch_finnhub_quote(ticker: str, api_key: str) -> dict | None:
    """從 Finnhub 取得美股報價。回傳標準格式 dict 或失敗時回傳 None。"""
    try:
        base_url = "https://finnhub.io/api/v1"
        headers = {"X-Finnhub-Token": api_key}

        async with aiohttp.ClientSession() as session:
            # 取得報價
            async with session.get(
                f"{base_url}/quote",
                params={"symbol": ticker},
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status != 200:
                    print(f"Finnhub 報價請求失敗: {ticker} status={resp.status}")
                    return None
                quote = await resp.json()

            # 檢查是否有有效價格（c=0 通常代表無效代號）
            price = quote.get("c", 0)
            if not price:
                print(f"Finnhub 無有效報價: {ticker}")
                return None

            prev_close = quote.get("pc", 0)
            price_change = quote.get("d", 0)
            price_change_percent = quote.get("dp", 0)

            # 取得公司名稱和 logo（使用快取）
            company_name = ""
            logo_url = None

            if ticker in _company_cache:
                company_name = _company_cache[ticker].get("name", "")
                logo_url = _company_cache[ticker].get("logo", None)
            else:
                try:
                    async with session.get(
                        f"{base_url}/stock/profile2",
                        params={"symbol": ticker},
                        headers=headers,
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as resp:
                        if resp.status == 200:
                            profile = await resp.json()
                            company_name = profile.get("name", "")
                            # Clearbit logo API 已停止服務，無備用 logo 來源；
                            # 缺 logo 時前端會以彩色字母圖示替代
                            logo_url = profile.get("logo", None)
                            _company_cache[ticker] = {
                                "name": company_name,
                                "logo": logo_url,
                            }
                except Exception as e:
                    print(f"Finnhub 公司資料請求失敗: {ticker} {e}")

            return {
                "ticker": ticker,
                "price": price,
                "prev_close": prev_close,
                "price_change": price_change,
                "price_change_percent": price_change_percent,
                "company_name": company_name,
                "logo_url": logo_url,
                "market_state": _us_market_state(),
                "extended_price": None,
                "extended_type": None,
                "extended_change": None,
                "extended_change_percent": None,
            }

    except Exception as e:
        print(f"Finnhub 取得報價異常: {ticker} {e}")
        return None
