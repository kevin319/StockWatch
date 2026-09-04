"""自選股清單（分組）相關端點。

本模組用 HTTPException 回傳狀態碼（400/401/404），前端據此分辨錯誤類型；
這與 stock.py 既有的「回 {"error": ...}」寫法不同，是刻意為之。

所有端點都需要登入，且使用者身分一律取自 current_user_email（驗證過的 JWT）——
請求本身不再帶 user_email，避免持有效 token 者填別人的 email 存取資料。
"""
import asyncio
import logging

import psycopg2
from fastapi import APIRouter, Depends, HTTPException
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel
from typing import List, Optional

from app.core.security import current_user_email
from app.models.db import get_db_connection
from app.models.migrations import DEFAULT_WATCHLIST_NAME, GROUP_NAME_MAX_LEN

logger = logging.getLogger(__name__)

router = APIRouter()

NAME_MAX_LEN = 50


DESC_MAX_LEN = 200


class CreateWatchlistRequest(BaseModel):
    name: str
    description: str = ""


class RenameWatchlistRequest(BaseModel):
    name: str
    description: Optional[str] = None


class ReorderWatchlistsRequest(BaseModel):
    ids: List[int]


def _clean_name(name: str) -> str:
    """去頭尾空白並驗證長度；不合法直接回 400。"""
    cleaned = (name or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="清單名稱不可空白")
    if len(cleaned) > NAME_MAX_LEN:
        raise HTTPException(status_code=400, detail=f"清單名稱不可超過 {NAME_MAX_LEN} 字")
    return cleaned


def _assert_owns(cur, user_email: str, watchlist_id: int) -> None:
    """確認清單屬於該使用者，否則 404（不洩漏清單是否存在）。"""
    cur.execute(
        "SELECT 1 FROM watchlists WHERE id = %s AND user_email = %s",
        (watchlist_id, user_email),
    )
    if cur.fetchone() is None:
        raise HTTPException(status_code=404, detail="找不到清單")


_LIST_SQL = """
    SELECT
        w.id,
        w.name,
        COALESCE(w.description, '') AS description,
        w.display_order,
        (SELECT COUNT(*) FROM watchlist_stocks ws WHERE ws.watchlist_id = w.id) AS count
    FROM watchlists w
    WHERE w.user_email = %s
    ORDER BY w.display_order, w.id;
"""


def _db_list_watchlists(user_email: str) -> list:
    """回傳清單列表；使用者若還沒有任何清單，lazy 建立一個預設清單。"""
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(_LIST_SQL, (user_email,))
        rows = [dict(r) for r in cur.fetchall()]
        if rows:
            return rows

        try:
            cur.execute(
                """INSERT INTO watchlists (user_email, name, display_order)
                   VALUES (%s, %s, 0)""",
                (user_email, DEFAULT_WATCHLIST_NAME),
            )
        except psycopg2.errors.ForeignKeyViolation:
            conn.rollback()
            raise HTTPException(status_code=404, detail="找不到使用者")
        conn.commit()
        cur.execute(_LIST_SQL, (user_email,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def _db_create_watchlist(user_email: str, name: str, description: str = "") -> dict:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM watchlists WHERE user_email = %s",
            (user_email,),
        )
        next_order = cur.fetchone()["next"]
        cur.execute(
            """INSERT INTO watchlists (user_email, name, description, display_order)
               VALUES (%s, %s, %s, %s)
               RETURNING id, name, COALESCE(description, '') AS description, display_order, 0 AS count""",
            (user_email, name, description[:DESC_MAX_LEN], next_order),
        )
        row = dict(cur.fetchone())
        conn.commit()
        return row
    except psycopg2.errors.UniqueViolation as e:
        conn.rollback()
        if e.diag.constraint_name != "idx_watchlists_user_name":
            raise
        raise HTTPException(status_code=400, detail="清單名稱已存在")
    finally:
        cur.close()
        conn.close()


def _db_rename_watchlist(user_email: str, watchlist_id: int, name: str, description: Optional[str] = None) -> dict:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        _assert_owns(cur, user_email, watchlist_id)
        if description is not None:
            cur.execute(
                """UPDATE watchlists SET name = %s, description = %s, updated_at = NOW()
                   WHERE id = %s AND user_email = %s
                   RETURNING id, name, COALESCE(description, '') AS description, display_order,
                       (SELECT COUNT(*) FROM watchlist_stocks ws WHERE ws.watchlist_id = %s) AS count""",
                (name, description[:DESC_MAX_LEN], watchlist_id, user_email, watchlist_id),
            )
        else:
            cur.execute(
                """UPDATE watchlists SET name = %s, updated_at = NOW()
                   WHERE id = %s AND user_email = %s
                   RETURNING id, name, COALESCE(description, '') AS description, display_order,
                       (SELECT COUNT(*) FROM watchlist_stocks ws WHERE ws.watchlist_id = %s) AS count""",
                (name, watchlist_id, user_email, watchlist_id),
            )
        row = dict(cur.fetchone())
        conn.commit()
        return row
    except psycopg2.errors.UniqueViolation as e:
        conn.rollback()
        if e.diag.constraint_name != "idx_watchlists_user_name":
            raise
        raise HTTPException(status_code=400, detail="清單名稱已存在")
    finally:
        cur.close()
        conn.close()


def _db_delete_watchlist(user_email: str, watchlist_id: int) -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        _assert_owns(cur, user_email, watchlist_id)
        # FOR UPDATE 鎖住該使用者所有清單列，避免兩個並發刪除同時讀到「還有兩個」
        # 而雙雙通過檢查，導致清單被刪光（違反「至少保留一個」的不變量）。
        cur.execute(
            "SELECT COUNT(*) FROM (SELECT 1 FROM watchlists WHERE user_email = %s FOR UPDATE) t",
            (user_email,),
        )
        if cur.fetchone()[0] <= 1:
            raise HTTPException(status_code=400, detail="至少要保留一個清單")
        # watchlist_stocks 有 ON DELETE CASCADE，歸屬列會一併刪除
        cur.execute(
            "DELETE FROM watchlists WHERE id = %s AND user_email = %s",
            (watchlist_id, user_email),
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def _db_reorder_watchlists(user_email: str, ids: list) -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        for index, watchlist_id in enumerate(ids):
            cur.execute(
                """UPDATE watchlists SET display_order = %s, updated_at = NOW()
                   WHERE id = %s AND user_email = %s""",
                (index, watchlist_id, user_email),
            )
        conn.commit()
    finally:
        cur.close()
        conn.close()


@router.get("/watchlists")
async def list_watchlists(user_email: str = Depends(current_user_email)):
    return await asyncio.to_thread(_db_list_watchlists, user_email)


@router.post("/watchlists")
async def create_watchlist(
    request: CreateWatchlistRequest,
    user_email: str = Depends(current_user_email),
):
    name = _clean_name(request.name)
    return await asyncio.to_thread(_db_create_watchlist, user_email, name, request.description)


@router.patch("/watchlists/{watchlist_id}")
async def rename_watchlist(
    watchlist_id: int,
    request: RenameWatchlistRequest,
    user_email: str = Depends(current_user_email),
):
    name = _clean_name(request.name)
    return await asyncio.to_thread(
        _db_rename_watchlist, user_email, watchlist_id, name, request.description
    )


@router.delete("/watchlists/{watchlist_id}")
async def delete_watchlist(
    watchlist_id: int,
    user_email: str = Depends(current_user_email),
):
    await asyncio.to_thread(_db_delete_watchlist, user_email, watchlist_id)
    return {"message": "已刪除清單"}


@router.post("/watchlists/reorder")
async def reorder_watchlists(
    request: ReorderWatchlistsRequest,
    user_email: str = Depends(current_user_email),
):
    await asyncio.to_thread(_db_reorder_watchlists, user_email, request.ids)
    return {"message": "已更新清單順序"}


class MembershipsRequest(BaseModel):
    ticker: str
    watchlist_ids: List[int]


class ReorderStocksRequest(BaseModel):
    tickers: List[str]


# 與 stock.py 的 _WATCHLIST_SQL 同樣的欄位，只是改以 watchlist_id 篩選
_STOCKS_SQL = """
    SELECT
        ws.ticker,
        ws.display_order,
        gs.group_id,
        COALESCE(g.name, '') AS group_name,
        COALESCE(g.description, '') AS group_description,
        COALESCE(g.display_order, 999999) AS group_order,
        COALESCE(sp.price, 0) as price,
        COALESCE(sp.prev_close, 0) as prev_close,
        COALESCE(sp.price_change, 0) as price_change,
        COALESCE(sp.price_change_percent, 0) as price_change_percent,
        COALESCE(sp.market_state, '') as market_state,
        COALESCE(sp.extended_price, 0) as extended_price,
        COALESCE(sp.extended_type, '') as extended_type,
        COALESCE(sp.extended_change, 0) as extended_change,
        COALESCE(sp.extended_change_percent, 0) as extended_change_percent
    FROM watchlist_stocks ws
    LEFT JOIN stock_prices sp ON ws.ticker = sp.ticker
    LEFT JOIN group_stocks gs ON gs.watchlist_stock_id = ws.id
    LEFT JOIN watchlist_groups g ON g.id = gs.group_id
    WHERE ws.watchlist_id = %s
    ORDER BY COALESCE(g.display_order, 999999), g.id NULLS LAST, ws.display_order;
"""


def _db_fetch_watchlist_stocks(user_email: str, watchlist_id: int) -> list:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        _assert_owns(cur, user_email, watchlist_id)
        cur.execute(_STOCKS_SQL, (watchlist_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def _db_fetch_memberships(user_email: str, ticker: str) -> list:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """SELECT ws.watchlist_id
               FROM watchlist_stocks ws
               JOIN watchlists w ON w.id = ws.watchlist_id
               WHERE w.user_email = %s AND ws.ticker = %s
               ORDER BY w.display_order, w.id""",
            (user_email, ticker),
        )
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def _db_set_memberships(user_email: str, ticker: str, watchlist_ids: list) -> None:
    """全量覆蓋某 ticker 的歸屬：勾選的加入（接在清單末端）、未勾選的移除。"""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        for watchlist_id in watchlist_ids:
            _assert_owns(cur, user_email, watchlist_id)

        # 移除未勾選的（限縮在該使用者自己的清單內）
        if watchlist_ids:
            cur.execute(
                """DELETE FROM watchlist_stocks ws
                   USING watchlists w
                   WHERE ws.watchlist_id = w.id
                     AND w.user_email = %s
                     AND ws.ticker = %s
                     AND NOT (ws.watchlist_id = ANY(%s))""",
                (user_email, ticker, watchlist_ids),
            )
        else:
            cur.execute(
                """DELETE FROM watchlist_stocks ws
                   USING watchlists w
                   WHERE ws.watchlist_id = w.id
                     AND w.user_email = %s
                     AND ws.ticker = %s""",
                (user_email, ticker),
            )

        # 加入勾選但還沒有的（display_order 接在該清單末端）
        # ON CONFLICT DO NOTHING 讓重複插入原子化地略過，避免併發重複提交時
        # 因 idx_unique_watchlist_ticker 撞號而丟出未捕捉的 UniqueViolation
        for watchlist_id in watchlist_ids:
            cur.execute(
                """INSERT INTO watchlist_stocks (user_email, watchlist_id, ticker, display_order)
                   SELECT %s, %s, %s,
                          COALESCE((SELECT MAX(display_order) + 1 FROM watchlist_stocks
                                    WHERE watchlist_id = %s), 0)
                   ON CONFLICT (watchlist_id, ticker) DO NOTHING""",
                (user_email, watchlist_id, ticker, watchlist_id),
            )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def _db_remove_stock(user_email: str, watchlist_id: int, ticker: str) -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        _assert_owns(cur, user_email, watchlist_id)
        cur.execute(
            """DELETE FROM watchlist_stocks
               WHERE watchlist_id = %s AND ticker = %s AND user_email = %s""",
            (watchlist_id, ticker, user_email),
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def _db_reorder_stocks(user_email: str, watchlist_id: int, tickers: list) -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        _assert_owns(cur, user_email, watchlist_id)
        for index, ticker in enumerate(tickers):
            cur.execute(
                """UPDATE watchlist_stocks SET display_order = %s, updated_at = NOW()
                   WHERE watchlist_id = %s AND ticker = %s AND user_email = %s""",
                (index, watchlist_id, ticker, user_email),
            )
        conn.commit()
    finally:
        cur.close()
        conn.close()


@router.get("/watchlists/{watchlist_id}/stocks")
async def get_watchlist_stocks(
    watchlist_id: int,
    user_email: str = Depends(current_user_email),
):
    return await asyncio.to_thread(_db_fetch_watchlist_stocks, user_email, watchlist_id)


@router.get("/watchlist/memberships/{ticker}")
async def get_memberships(
    ticker: str,
    user_email: str = Depends(current_user_email),
):
    return await asyncio.to_thread(_db_fetch_memberships, user_email, ticker)


@router.put("/watchlist/memberships")
async def set_memberships(
    request: MembershipsRequest,
    user_email: str = Depends(current_user_email),
):
    await asyncio.to_thread(
        _db_set_memberships, user_email, request.ticker, request.watchlist_ids
    )
    return {"message": "已更新歸屬"}


@router.delete("/watchlists/{watchlist_id}/stocks/{ticker}")
async def remove_stock(
    watchlist_id: int,
    ticker: str,
    user_email: str = Depends(current_user_email),
):
    await asyncio.to_thread(_db_remove_stock, user_email, watchlist_id, ticker)
    return {"message": "已從清單移除"}


@router.post("/watchlists/{watchlist_id}/reorder")
async def reorder_stocks(
    watchlist_id: int,
    request: ReorderStocksRequest,
    user_email: str = Depends(current_user_email),
):
    await asyncio.to_thread(
        _db_reorder_stocks, user_email, watchlist_id, request.tickers
    )
    return {"message": "已更新股票順序"}


# ═══════ 子分組 CRUD ═══════


class CreateGroupRequest(BaseModel):
    name: str
    description: str = ""


class UpdateGroupRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class ReorderGroupsRequest(BaseModel):
    ids: List[int]


class SetGroupStocksRequest(BaseModel):
    tickers: List[str]


def _clean_group_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="分組名稱不可空白")
    if len(cleaned) > GROUP_NAME_MAX_LEN:
        raise HTTPException(status_code=400, detail=f"分組名稱不可超過 {GROUP_NAME_MAX_LEN} 字")
    return cleaned


def _assert_group_owns(cur, user_email: str, watchlist_id: int, group_id: int) -> None:
    cur.execute(
        """SELECT 1 FROM watchlist_groups g
           JOIN watchlists w ON w.id = g.watchlist_id
           WHERE g.id = %s AND g.watchlist_id = %s AND w.user_email = %s""",
        (group_id, watchlist_id, user_email),
    )
    if cur.fetchone() is None:
        raise HTTPException(status_code=404, detail="找不到分組")


def _db_list_groups(user_email: str, watchlist_id: int) -> list:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        _assert_owns(cur, user_email, watchlist_id)
        cur.execute(
            """SELECT g.id, g.name, COALESCE(g.description, '') AS description, g.display_order,
                      (SELECT COUNT(*) FROM group_stocks gs WHERE gs.group_id = g.id) AS count
               FROM watchlist_groups g
               WHERE g.watchlist_id = %s
               ORDER BY g.display_order, g.id""",
            (watchlist_id,),
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def _db_create_group(user_email: str, watchlist_id: int, name: str, description: str = "") -> dict:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        _assert_owns(cur, user_email, watchlist_id)
        cur.execute(
            "SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM watchlist_groups WHERE watchlist_id = %s",
            (watchlist_id,),
        )
        next_order = cur.fetchone()["next"]
        cur.execute(
            """INSERT INTO watchlist_groups (watchlist_id, name, description, display_order)
               VALUES (%s, %s, %s, %s)
               RETURNING id, name, COALESCE(description, '') AS description, display_order, 0 AS count""",
            (watchlist_id, name, description[:DESC_MAX_LEN], next_order),
        )
        row = dict(cur.fetchone())
        conn.commit()
        return row
    except psycopg2.errors.UniqueViolation as e:
        conn.rollback()
        if e.diag.constraint_name != "idx_unique_group_name":
            raise
        raise HTTPException(status_code=400, detail="分組名稱已存在")
    finally:
        cur.close()
        conn.close()


def _db_update_group(user_email: str, watchlist_id: int, group_id: int,
                     name: Optional[str], description: Optional[str]) -> dict:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        _assert_group_owns(cur, user_email, watchlist_id, group_id)
        sets, params = [], []
        if name is not None:
            sets.append("name = %s")
            params.append(name)
        if description is not None:
            sets.append("description = %s")
            params.append(description[:DESC_MAX_LEN])
        if not sets:
            raise HTTPException(status_code=400, detail="沒有要更新的欄位")
        params.extend([group_id, watchlist_id])
        cur.execute(
            f"""UPDATE watchlist_groups SET {', '.join(sets)}
                WHERE id = %s AND watchlist_id = %s
                RETURNING id, name, COALESCE(description, '') AS description, display_order,
                    (SELECT COUNT(*) FROM group_stocks gs WHERE gs.group_id = watchlist_groups.id) AS count""",
            params,
        )
        row = dict(cur.fetchone())
        conn.commit()
        return row
    except psycopg2.errors.UniqueViolation as e:
        conn.rollback()
        if e.diag.constraint_name != "idx_unique_group_name":
            raise
        raise HTTPException(status_code=400, detail="分組名稱已存在")
    finally:
        cur.close()
        conn.close()


def _db_delete_group(user_email: str, watchlist_id: int, group_id: int) -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        _assert_group_owns(cur, user_email, watchlist_id, group_id)
        cur.execute("DELETE FROM watchlist_groups WHERE id = %s", (group_id,))
        conn.commit()
    finally:
        cur.close()
        conn.close()


def _db_reorder_groups(user_email: str, watchlist_id: int, ids: list) -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        _assert_owns(cur, user_email, watchlist_id)
        for index, gid in enumerate(ids):
            cur.execute(
                "UPDATE watchlist_groups SET display_order = %s WHERE id = %s AND watchlist_id = %s",
                (index, gid, watchlist_id),
            )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def _db_set_group_stocks(user_email: str, watchlist_id: int, group_id: int, tickers: list) -> None:
    """批次設定某分組包含哪些股票（多對多）：先清除此分組的關聯，再建立勾選的。"""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        _assert_group_owns(cur, user_email, watchlist_id, group_id)
        cur.execute(
            """DELETE FROM group_stocks
               WHERE group_id = %s
                 AND watchlist_stock_id IN (
                     SELECT id FROM watchlist_stocks WHERE watchlist_id = %s
                 )""",
            (group_id, watchlist_id),
        )
        if tickers:
            cur.execute(
                """INSERT INTO group_stocks (group_id, watchlist_stock_id)
                   SELECT %s, ws.id
                   FROM watchlist_stocks ws
                   WHERE ws.watchlist_id = %s AND ws.ticker = ANY(%s)
                   ON CONFLICT DO NOTHING""",
                (group_id, watchlist_id, tickers),
            )
        conn.commit()
    finally:
        cur.close()
        conn.close()


def _db_get_group_stocks(user_email: str, watchlist_id: int, group_id: int) -> list:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        _assert_group_owns(cur, user_email, watchlist_id, group_id)
        cur.execute(
            """SELECT ws.ticker
               FROM group_stocks gs
               JOIN watchlist_stocks ws ON ws.id = gs.watchlist_stock_id
               WHERE gs.group_id = %s AND ws.watchlist_id = %s
               ORDER BY ws.display_order""",
            (group_id, watchlist_id),
        )
        return [r[0] for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


@router.get("/watchlists/{watchlist_id}/groups")
async def list_groups(watchlist_id: int, user_email: str = Depends(current_user_email)):
    return await asyncio.to_thread(_db_list_groups, user_email, watchlist_id)


@router.post("/watchlists/{watchlist_id}/groups")
async def create_group(
    watchlist_id: int,
    request: CreateGroupRequest,
    user_email: str = Depends(current_user_email),
):
    name = _clean_group_name(request.name)
    return await asyncio.to_thread(_db_create_group, user_email, watchlist_id, name, request.description)


@router.patch("/watchlists/{watchlist_id}/groups/{group_id}")
async def update_group(
    watchlist_id: int,
    group_id: int,
    request: UpdateGroupRequest,
    user_email: str = Depends(current_user_email),
):
    name = _clean_group_name(request.name) if request.name is not None else None
    return await asyncio.to_thread(
        _db_update_group, user_email, watchlist_id, group_id, name, request.description
    )


@router.delete("/watchlists/{watchlist_id}/groups/{group_id}")
async def delete_group(
    watchlist_id: int,
    group_id: int,
    user_email: str = Depends(current_user_email),
):
    await asyncio.to_thread(_db_delete_group, user_email, watchlist_id, group_id)
    return {"message": "已刪除分組"}


@router.post("/watchlists/{watchlist_id}/groups/reorder")
async def reorder_groups(
    watchlist_id: int,
    request: ReorderGroupsRequest,
    user_email: str = Depends(current_user_email),
):
    await asyncio.to_thread(_db_reorder_groups, user_email, watchlist_id, request.ids)
    return {"message": "已更新分組順序"}


@router.get("/watchlists/{watchlist_id}/groups/{group_id}/stocks")
async def get_group_stocks(
    watchlist_id: int,
    group_id: int,
    user_email: str = Depends(current_user_email),
):
    return await asyncio.to_thread(_db_get_group_stocks, user_email, watchlist_id, group_id)


@router.put("/watchlists/{watchlist_id}/groups/{group_id}/stocks")
async def set_group_stocks(
    watchlist_id: int,
    group_id: int,
    request: SetGroupStocksRequest,
    user_email: str = Depends(current_user_email),
):
    await asyncio.to_thread(
        _db_set_group_stocks, user_email, watchlist_id, group_id, request.tickers
    )
    return {"message": "已更新分組股票"}
