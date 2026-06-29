import aiohttp
import re
from datetime import datetime, timezone, timedelta

_HKT = timezone(timedelta(hours=8))

# 公司名稱快取
_name_cache = {}


def _hk_market_state() -> str:
    """根據香港時間判斷港股市場狀態。"""
    now = datetime.now(_HKT)
    if now.weekday() >= 5:
        return "CLOSED"
    t = now.hour * 60 + now.minute
    # 09:30-12:00 上午交易, 13:00-16:00 下午交易
    if (570 <= t < 720) or (780 <= t < 960):
        return "REGULAR"
    return "CLOSED"


def _cn_market_state() -> str:
    """根據北京時間判斷 A 股市場狀態。"""
    now = datetime.now(_HKT)  # UTC+8，與 CST 相同
    if now.weekday() >= 5:
        return "CLOSED"
    t = now.hour * 60 + now.minute
    # 09:30-11:30 上午交易, 13:00-15:00 下午交易
    if (570 <= t < 690) or (780 <= t < 900):
        return "REGULAR"
    return "CLOSED"


def _ticker_to_sina(ticker: str) -> str | None:
    """將 Yahoo 格式代號轉換為新浪 API 格式。

    .HK  -> hk + 5位數（補零）
    .SS  -> sh + 6位代碼
    .SZ  -> sz + 6位代碼
    """
    upper = ticker.upper()
    if upper.endswith(".HK"):
        code = ticker[: -len(".HK")]
        # 港股代號補零至 5 位
        return "hk" + code.zfill(5)
    elif upper.endswith(".SS"):
        code = ticker[: -len(".SS")]
        return "sh" + code
    elif upper.endswith(".SZ"):
        code = ticker[: -len(".SZ")]
        return "sz" + code
    return None


def _parse_hk(fields: list[str], ticker: str) -> dict | None:
    """解析港股回應（19 欄位）。"""
    if len(fields) < 9:
        return None

    try:
        price = float(fields[6])
        if price <= 0:
            return None
        prev_close = float(fields[3])
        price_change = float(fields[7])
        price_change_percent = float(fields[8])
        # 優先中文名稱，備用英文名稱
        company_name = fields[1].strip() or fields[0].strip()

        return {
            "ticker": ticker,
            "price": price,
            "prev_close": prev_close,
            "price_change": round(price_change, 4),
            "price_change_percent": round(price_change_percent, 2),
            "company_name": company_name,
            "logo_url": None,
            "market_state": _hk_market_state(),
            "extended_price": None,
            "extended_type": None,
            "extended_change": None,
            "extended_change_percent": None,
        }
    except (ValueError, IndexError) as e:
        print(f"AStock 解析港股欄位錯誤: {ticker} {e}")
        return None


def _parse_cn(fields: list[str], ticker: str) -> dict | None:
    """解析 A 股回應（33+ 欄位）。"""
    if len(fields) < 10:
        return None

    try:
        price = float(fields[3])
        if price <= 0:
            return None
        prev_close = float(fields[2])
        price_change = price - prev_close
        price_change_percent = (price_change / prev_close * 100) if prev_close else 0
        company_name = fields[0].strip()

        return {
            "ticker": ticker,
            "price": price,
            "prev_close": prev_close,
            "price_change": round(price_change, 4),
            "price_change_percent": round(price_change_percent, 2),
            "company_name": company_name,
            "logo_url": None,
            "market_state": _cn_market_state(),
            "extended_price": None,
            "extended_type": None,
            "extended_change": None,
            "extended_change_percent": None,
        }
    except (ValueError, IndexError) as e:
        print(f"AStock 解析 A 股欄位錯誤: {ticker} {e}")
        return None


async def fetch_astock_quote(ticker: str) -> dict | None:
    """從新浪財經取得港股 / A 股報價。回傳標準格式 dict 或失敗時回傳 None。"""
    try:
        sina_symbol = _ticker_to_sina(ticker)
        if not sina_symbol:
            print(f"AStock 無法解析代號: {ticker}")
            return None

        url = f"https://hq.sinajs.cn/list={sina_symbol}"
        headers = {"Referer": "https://finance.sina.com.cn"}

        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status != 200:
                    print(f"AStock 請求失敗: {ticker} status={resp.status}")
                    return None
                raw = await resp.read()

        # 回應為 GBK 編碼
        text = raw.decode("gbk", errors="replace")

        # 解析格式: var hq_str_xxx="field0,field1,...";
        match = re.search(r'"([^"]*)"', text)
        if not match or not match.group(1):
            print(f"AStock 回應為空: {ticker}")
            return None

        fields = match.group(1).split(",")

        # 根據前綴判斷解析方式
        if sina_symbol.startswith("hk"):
            result = _parse_hk(fields, ticker)
        else:
            result = _parse_cn(fields, ticker)

        if result:
            _name_cache[ticker] = result["company_name"]
            print(f"AStock 取得報價成功: {ticker}")

        return result

    except Exception as e:
        print(f"AStock 取得報價異常: {ticker} {e}")
        return None
