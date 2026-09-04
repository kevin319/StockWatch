"""啟動時執行的 idempotent schema 遷移。

沿用 main.py `_ensure_summary_table()` 的慣例：同步函式，於 asyncio.to_thread 內呼叫，
每一步都必須可重複執行而無副作用（資料庫是持久 volume，內有真實使用者資料）。
"""
import logging

from app.models.db import get_db_connection

logger = logging.getLogger(__name__)

DEFAULT_WATCHLIST_NAME = "自選股"
GROUP_NAME_MAX_LEN = 50


def ensure_watchlist_groups() -> None:
    """建立 watchlists 表並把既有自選股遷入各使用者的預設清單。"""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # 1. 清單表
        cur.execute(
            """CREATE TABLE IF NOT EXISTS watchlists (
                   id SERIAL PRIMARY KEY,
                   user_email VARCHAR(255) NOT NULL
                       REFERENCES users(email) ON DELETE CASCADE,
                   name VARCHAR(50) NOT NULL,
                   display_order INTEGER NOT NULL,
                   created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                   updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
               );"""
        )
        cur.execute(
            """CREATE INDEX IF NOT EXISTS idx_watchlists_user
                   ON watchlists(user_email, display_order);"""
        )
        # 同一使用者不分大小寫不可同名
        cur.execute(
            """CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlists_user_name
                   ON watchlists(user_email, lower(name));"""
        )

        # 2. 已有自選股但還沒有任何清單的使用者，補一個預設清單
        cur.execute(
            """INSERT INTO watchlists (user_email, name, display_order)
               SELECT DISTINCT ws.user_email, %s, 0
               FROM watchlist_stocks ws
               WHERE NOT EXISTS (
                   SELECT 1 FROM watchlists w WHERE w.user_email = ws.user_email
               );""",
            (DEFAULT_WATCHLIST_NAME,),
        )

        # 3. 歸屬欄位（先允許 NULL，填完再上約束）
        cur.execute(
            "ALTER TABLE watchlist_stocks ADD COLUMN IF NOT EXISTS watchlist_id INTEGER;"
        )

        # 4. 既有列指向該使用者排序最前的清單
        cur.execute(
            """UPDATE watchlist_stocks ws
               SET watchlist_id = (
                   SELECT w.id FROM watchlists w
                   WHERE w.user_email = ws.user_email
                   ORDER BY w.display_order, w.id
                   LIMIT 1
               )
               WHERE ws.watchlist_id IS NULL;"""
        )

        # 5. 外鍵（information_schema 無此約束時才加，避免重複執行報錯）
        cur.execute(
            """DO $$
               BEGIN
                   IF NOT EXISTS (
                       SELECT 1 FROM information_schema.table_constraints
                       WHERE constraint_name = 'fk_watchlist_stocks_watchlist'
                         AND table_name = 'watchlist_stocks'
                   ) THEN
                       ALTER TABLE watchlist_stocks
                           ADD CONSTRAINT fk_watchlist_stocks_watchlist
                           FOREIGN KEY (watchlist_id)
                           REFERENCES watchlists(id) ON DELETE CASCADE;
                   END IF;
               END $$;"""
        )
        cur.execute(
            "ALTER TABLE watchlist_stocks ALTER COLUMN watchlist_id SET NOT NULL;"
        )

        # 6. 換唯一索引：(user_email, ticker) → (watchlist_id, ticker)，解鎖多重歸屬
        cur.execute("DROP INDEX IF EXISTS idx_unique_user_ticker;")
        cur.execute(
            """CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_watchlist_ticker
                   ON watchlist_stocks(watchlist_id, ticker);"""
        )

        conn.commit()
    finally:
        cur.close()
        conn.close()


def ensure_group_stocks_m2m() -> None:
    """將分組從一對一（watchlist_stocks.group_id）遷移到多對多（group_stocks 關聯表）。"""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """CREATE TABLE IF NOT EXISTS group_stocks (
                   id SERIAL PRIMARY KEY,
                   group_id INTEGER NOT NULL
                       REFERENCES watchlist_groups(id) ON DELETE CASCADE,
                   watchlist_stock_id INTEGER NOT NULL
                       REFERENCES watchlist_stocks(id) ON DELETE CASCADE,
                   UNIQUE (group_id, watchlist_stock_id)
               );"""
        )
        cur.execute(
            """CREATE INDEX IF NOT EXISTS idx_group_stocks_stock
                   ON group_stocks(watchlist_stock_id);"""
        )

        # 把既有的 group_id 資料搬到 junction table（只搬未搬過的）
        cur.execute(
            """INSERT INTO group_stocks (group_id, watchlist_stock_id)
               SELECT ws.group_id, ws.id
               FROM watchlist_stocks ws
               WHERE ws.group_id IS NOT NULL
                 AND NOT EXISTS (
                     SELECT 1 FROM group_stocks gs
                     WHERE gs.group_id = ws.group_id AND gs.watchlist_stock_id = ws.id
                 );"""
        )

        conn.commit()
    finally:
        cur.close()
        conn.close()

def ensure_watchlist_subgroups() -> None:
    """建立清單內子分組機制：watchlist_groups 表 + watchlist_stocks.group_id + description 欄位。"""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # 1. watchlists 加 description 欄位
        cur.execute(
            "ALTER TABLE watchlists ADD COLUMN IF NOT EXISTS description VARCHAR(200) DEFAULT '';"
        )

        # 2. 建立 watchlist_groups 表
        cur.execute(
            """CREATE TABLE IF NOT EXISTS watchlist_groups (
                   id SERIAL PRIMARY KEY,
                   watchlist_id INTEGER NOT NULL
                       REFERENCES watchlists(id) ON DELETE CASCADE,
                   name VARCHAR(50) NOT NULL,
                   description VARCHAR(200) DEFAULT '',
                   display_order INTEGER NOT NULL DEFAULT 0,
                   created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
               );"""
        )
        cur.execute(
            """CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_group_name
                   ON watchlist_groups(watchlist_id, lower(name));"""
        )
        cur.execute(
            """CREATE INDEX IF NOT EXISTS idx_groups_watchlist
                   ON watchlist_groups(watchlist_id, display_order);"""
        )

        # 3. watchlist_stocks 加 group_id (nullable FK, ON DELETE SET NULL)
        cur.execute(
            "ALTER TABLE watchlist_stocks ADD COLUMN IF NOT EXISTS group_id INTEGER;"
        )
        cur.execute(
            """DO $$
               BEGIN
                   IF NOT EXISTS (
                       SELECT 1 FROM information_schema.table_constraints
                       WHERE constraint_name = 'fk_watchlist_stocks_group'
                         AND table_name = 'watchlist_stocks'
                   ) THEN
                       ALTER TABLE watchlist_stocks
                           ADD CONSTRAINT fk_watchlist_stocks_group
                           FOREIGN KEY (group_id)
                           REFERENCES watchlist_groups(id) ON DELETE SET NULL;
                   END IF;
               END $$;"""
        )

        conn.commit()
    finally:
        cur.close()
        conn.close()
