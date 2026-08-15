"""自選股清單（分組）相關端點。

本模組用 HTTPException 回傳狀態碼（400/404），前端據此分辨錯誤類型；
這與 stock.py 既有的「回 {"error": ...}」寫法不同，是刻意為之。
"""
import asyncio
import logging

import psycopg2
from fastapi import APIRouter, HTTPException
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel
from typing import List

from app.models.db import get_db_connection
from app.models.migrations import DEFAULT_WATCHLIST_NAME

logger = logging.getLogger(__name__)

router = APIRouter()

NAME_MAX_LEN = 50


class CreateWatchlistRequest(BaseModel):
    user_email: str
    name: str


class RenameWatchlistRequest(BaseModel):
    user_email: str
    name: str


class ReorderWatchlistsRequest(BaseModel):
    user_email: str
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

        cur.execute(
            """INSERT INTO watchlists (user_email, name, display_order)
               VALUES (%s, %s, 0)""",
            (user_email, DEFAULT_WATCHLIST_NAME),
        )
        conn.commit()
        cur.execute(_LIST_SQL, (user_email,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def _db_create_watchlist(user_email: str, name: str) -> dict:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM watchlists WHERE user_email = %s",
            (user_email,),
        )
        next_order = cur.fetchone()["next"]
        cur.execute(
            """INSERT INTO watchlists (user_email, name, display_order)
               VALUES (%s, %s, %s)
               RETURNING id, name, display_order, 0 AS count""",
            (user_email, name, next_order),
        )
        row = dict(cur.fetchone())
        conn.commit()
        return row
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=400, detail="清單名稱已存在")
    finally:
        cur.close()
        conn.close()


def _db_rename_watchlist(user_email: str, watchlist_id: int, name: str) -> dict:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        _assert_owns(cur, user_email, watchlist_id)
        cur.execute(
            """UPDATE watchlists SET name = %s, updated_at = NOW()
               WHERE id = %s
               RETURNING id, name, display_order,
                   (SELECT COUNT(*) FROM watchlist_stocks ws WHERE ws.watchlist_id = %s) AS count""",
            (name, watchlist_id, watchlist_id),
        )
        row = dict(cur.fetchone())
        conn.commit()
        return row
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=400, detail="清單名稱已存在")
    finally:
        cur.close()
        conn.close()


def _db_delete_watchlist(user_email: str, watchlist_id: int) -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        _assert_owns(cur, user_email, watchlist_id)
        cur.execute("SELECT COUNT(*) FROM watchlists WHERE user_email = %s", (user_email,))
        if cur.fetchone()[0] <= 1:
            raise HTTPException(status_code=400, detail="至少要保留一個清單")
        # watchlist_stocks 有 ON DELETE CASCADE，歸屬列會一併刪除
        cur.execute("DELETE FROM watchlists WHERE id = %s", (watchlist_id,))
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


@router.get("/watchlists/{user_email}")
async def list_watchlists(user_email: str):
    return await asyncio.to_thread(_db_list_watchlists, user_email)


@router.post("/watchlists")
async def create_watchlist(request: CreateWatchlistRequest):
    name = _clean_name(request.name)
    return await asyncio.to_thread(_db_create_watchlist, request.user_email, name)


@router.patch("/watchlists/{watchlist_id}")
async def rename_watchlist(watchlist_id: int, request: RenameWatchlistRequest):
    name = _clean_name(request.name)
    return await asyncio.to_thread(
        _db_rename_watchlist, request.user_email, watchlist_id, name
    )


@router.delete("/watchlists/{watchlist_id}")
async def delete_watchlist(watchlist_id: int, user_email: str):
    await asyncio.to_thread(_db_delete_watchlist, user_email, watchlist_id)
    return {"message": "已刪除清單"}


@router.post("/watchlists/reorder")
async def reorder_watchlists(request: ReorderWatchlistsRequest):
    await asyncio.to_thread(_db_reorder_watchlists, request.user_email, request.ids)
    return {"message": "已更新清單順序"}
