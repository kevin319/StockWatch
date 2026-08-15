"""watchlist groups 遷移測試。

打真實資料庫（需 POSTGRES_HOST=localhost）。遷移為 idempotent，
測試在已遷移的資料庫上重複執行也應通過。
"""
import unittest

from app.models.db import get_db_connection
from app.models.migrations import ensure_watchlist_groups

TEST_EMAIL = "migration-test@example.com"


def _query(sql, params=None):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


def _execute(sql, params=None):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        conn.commit()
    finally:
        cur.close()
        conn.close()


class TestWatchlistGroupsMigration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ensure_watchlist_groups()

    def test_idempotent(self):
        """重複執行不拋錯，且不改變資料筆數。"""
        before = _query("SELECT COUNT(*) FROM watchlist_stocks")[0][0]
        ensure_watchlist_groups()
        ensure_watchlist_groups()
        after = _query("SELECT COUNT(*) FROM watchlist_stocks")[0][0]
        self.assertEqual(before, after)

    def test_watchlists_table_shape(self):
        cols = dict(_query(
            """SELECT column_name, is_nullable FROM information_schema.columns
               WHERE table_name = 'watchlists'"""
        ))
        self.assertEqual(
            set(cols),
            {"id", "user_email", "name", "display_order", "created_at", "updated_at"},
        )
        self.assertEqual(cols["user_email"], "NO")
        self.assertEqual(cols["name"], "NO")
        self.assertEqual(cols["display_order"], "NO")

    def test_watchlist_id_not_null(self):
        nullable = _query(
            """SELECT is_nullable FROM information_schema.columns
               WHERE table_name = 'watchlist_stocks' AND column_name = 'watchlist_id'"""
        )
        self.assertEqual(nullable, [("NO",)])

    def test_unique_index_swapped(self):
        names = {r[0] for r in _query(
            "SELECT indexname FROM pg_indexes WHERE tablename = 'watchlist_stocks'"
        )}
        self.assertIn("idx_unique_watchlist_ticker", names)
        self.assertNotIn("idx_unique_user_ticker", names)

    def test_every_stock_belongs_to_its_owner_list(self):
        """每筆自選股都指向一個屬於同一使用者的清單，無孤兒列。"""
        orphans = _query(
            """SELECT COUNT(*) FROM watchlist_stocks ws
               LEFT JOIN watchlists w ON w.id = ws.watchlist_id
               WHERE w.id IS NULL OR w.user_email <> ws.user_email"""
        )[0][0]
        self.assertEqual(orphans, 0)

    def test_every_stock_owner_has_at_least_one_list(self):
        """每個持有自選股的使用者至少有一個清單。

        這是遷移保證的持久不變量（NOT NULL 外鍵 + 遷移本身），且不會被
        清單改名破壞——不同於「清單名稱為自選股」，後者只在新使用者首次
        建立時成立，使用者事後可自由改名（見 Task 6），因此不適合在這裡
        斷言字面名稱。「自選股」這個預設名稱由
        tests/test_watchlists.py::test_get_creates_default_list_for_new_user
        對自建的 fixture 使用者驗證。"""
        missing = _query(
            """SELECT COUNT(*) FROM (
                   SELECT DISTINCT user_email FROM watchlist_stocks
               ) u
               WHERE NOT EXISTS (
                   SELECT 1 FROM watchlists w WHERE w.user_email = u.user_email
               )"""
        )[0][0]
        self.assertEqual(missing, 0)

    def test_same_ticker_allowed_in_two_lists(self):
        """多重歸屬：同一支股票可同時存在於兩個不同清單。"""
        _execute(
            "INSERT INTO users (email, name) VALUES (%s, %s) ON CONFLICT (email) DO NOTHING",
            (TEST_EMAIL, "Migration Test"),
        )
        try:
            _execute(
                """INSERT INTO watchlists (user_email, name, display_order)
                   VALUES (%s, 'A', 0), (%s, 'B', 1)""",
                (TEST_EMAIL, TEST_EMAIL),
            )
            ids = [r[0] for r in _query(
                "SELECT id FROM watchlists WHERE user_email = %s ORDER BY display_order",
                (TEST_EMAIL,),
            )]
            for wid in ids:
                _execute(
                    """INSERT INTO watchlist_stocks (user_email, ticker, display_order, watchlist_id)
                       VALUES (%s, 'ZZZZ', 0, %s)""",
                    (TEST_EMAIL, wid),
                )
            count = _query(
                "SELECT COUNT(*) FROM watchlist_stocks WHERE user_email = %s AND ticker = 'ZZZZ'",
                (TEST_EMAIL,),
            )[0][0]
            self.assertEqual(count, 2)
        finally:
            _execute("DELETE FROM users WHERE email = %s", (TEST_EMAIL,))


if __name__ == "__main__":
    unittest.main()
