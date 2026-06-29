import aiohttp
from datetime import datetime, timezone, timedelta

_TW = timezone(timedelta(hours=8))

def _tw_market_state() -> str:
    """根據台北時間判斷台股市場狀態。"""
    now = datetime.now(_TW)
    if now.weekday() >= 5:
        return "CLOSED"
    t = now.hour * 60 + now.minute
    if 540 <= t < 810:   # 9:00-13:30
        return "REGULAR"
    return "CLOSED"


def _first_quote(field: str) -> float | None:
    """從 '_' 分隔的五檔報價字串取第一個有效價格。"""
    for part in field.split("_"):
        if part and part != "-":
            try:
                v = float(part)
            except ValueError:
                continue
            if v > 0:
                return v
    return None


def _ticker_to_ex_ch(ticker: str) -> str:
    """將 Yahoo 格式的台股代號轉換為 TWSE API 的 ex_ch 參數。
    例如: '2330.TW' -> 'tse_2330.tw', '6510.TWO' -> 'otc_6510.tw'
    """
    upper = ticker.upper()
    if upper.endswith(".TWO"):
        code = ticker[: -len(".TWO")]
        return f"otc_{code}.tw"
    elif upper.endswith(".TW"):
        code = ticker[: -len(".TW")]
        return f"tse_{code}.tw"
    return ""


async def fetch_twse_quote(ticker: str) -> dict | None:
    """從 TWSE 取得台股報價。回傳標準格式 dict 或失敗時回傳 None。"""
    try:
        ex_ch = _ticker_to_ex_ch(ticker)
        if not ex_ch:
            print(f"TWSE 無法解析代號: {ticker}")
            return None

        url = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
        params = {"ex_ch": ex_ch, "json": "1", "delay": "0"}

        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                params=params,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status != 200:
                    print(f"TWSE 請求失敗: {ticker} status={resp.status}")
                    return None
                data = await resp.json(content_type=None)

        # 檢查回應結構
        if data.get("rtcode") != "0000" or not data.get("msgArray"):
            print(f"TWSE 回應異常: {ticker} rtcode={data.get('rtcode')}")
            return None

        stock = data["msgArray"][0]

        # 檢查是否為無效代號
        if not stock.get("c") or stock.get("c") == "":
            print(f"TWSE 無效代號: {ticker}")
            return None

        # 解析價格（z 可能是 "-" 表示尚未成交）
        z = stock.get("z", "-")
        y = stock.get("y", "-")

        price = None
        if z and z != "-":
            price = float(z)
        elif stock.get("pz") and stock["pz"] != "-":
            # 試撮價格作為備用
            price = float(stock["pz"])
        else:
            # TWSE 快照常無最新成交價（z="-"），改用最佳買賣盤中價估當前價，
            # 避免 fallback 到延遲約 20 分鐘的 yfinance
            bid = _first_quote(stock.get("b", ""))
            ask = _first_quote(stock.get("a", ""))
            if bid and ask:
                price = round((bid + ask) / 2, 2)
            elif bid:
                price = bid
            elif ask:
                price = ask

        prev_close = None
        if y and y != "-":
            prev_close = float(y)

        if price is None or prev_close is None:
            print(f"TWSE 無有效價格: {ticker} z={z} y={y}")
            return None

        price_change = price - prev_close
        price_change_percent = (price_change / prev_close * 100) if prev_close else 0

        company_name = stock.get("n", "")
        # 台股 logo 透過 Clearbit 嘗試，但通常沒有，設為 None
        logo_url = None

        return {
            "ticker": ticker,
            "price": price,
            "prev_close": prev_close,
            "price_change": round(price_change, 4),
            "price_change_percent": round(price_change_percent, 2),
            "company_name": company_name,
            "logo_url": logo_url,
            "market_state": _tw_market_state(),
            "extended_price": None,
            "extended_type": None,
            "extended_change": None,
            "extended_change_percent": None,
        }

    except Exception as e:
        print(f"TWSE 取得報價異常: {ticker} {e}")
        return None
