"""清單 API 整合測試。打真實資料庫（需 POSTGRES_HOST=localhost）。

用專用測試 email，setUp/tearDown 自行清理，不碰真實使用者資料。
"""
import unittest

from fastapi.testclient import TestClient

from main import app
from app.models.db import get_db_connection

EMAIL = "watchlist-api-test@example.com"
OTHER_EMAIL = "watchlist-api-other@example.com"


def _execute(sql, params=None):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        conn.commit()
    finally:
        cur.close()
        conn.close()


class TestWatchlistCrud(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        for email in (EMAIL, OTHER_EMAIL):
            _execute("DELETE FROM users WHERE email = %s", (email,))
            _execute(
                "INSERT INTO users (email, name) VALUES (%s, %s)",
                (email, "Watchlist Test"),
            )

    def tearDown(self):
        for email in (EMAIL, OTHER_EMAIL):
            _execute("DELETE FROM users WHERE email = %s", (email,))

    def test_get_creates_default_list_for_new_user(self):
        """新使用者第一次取清單，後端 lazy 建立一個「自選股」空清單。"""
        r = self.client.get(f"/watchlists/{EMAIL}")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["name"], "自選股")
        self.assertEqual(data[0]["count"], 0)
        self.assertIsInstance(data[0]["id"], int)

    def test_create_rename_delete(self):
        self.client.get(f"/watchlists/{EMAIL}")  # 先有預設清單

        r = self.client.post("/watchlists", json={"user_email": EMAIL, "name": "US"})
        self.assertEqual(r.status_code, 200)
        wid = r.json()["id"]
        self.assertEqual(r.json()["name"], "US")

        r = self.client.patch(f"/watchlists/{wid}", json={"user_email": EMAIL, "name": "美股"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["name"], "美股")

        r = self.client.delete(f"/watchlists/{wid}?user_email={EMAIL}")
        self.assertEqual(r.status_code, 200)

        names = [w["name"] for w in self.client.get(f"/watchlists/{EMAIL}").json()]
        self.assertEqual(names, ["自選股"])

    def test_duplicate_name_rejected(self):
        self.client.get(f"/watchlists/{EMAIL}")
        self.client.post("/watchlists", json={"user_email": EMAIL, "name": "US"})
        r = self.client.post("/watchlists", json={"user_email": EMAIL, "name": "us"})
        self.assertEqual(r.status_code, 400)

    def test_blank_name_rejected(self):
        self.client.get(f"/watchlists/{EMAIL}")
        r = self.client.post("/watchlists", json={"user_email": EMAIL, "name": "   "})
        self.assertEqual(r.status_code, 400)

    def test_cannot_delete_last_list(self):
        lists = self.client.get(f"/watchlists/{EMAIL}").json()
        r = self.client.delete(f"/watchlists/{lists[0]['id']}?user_email={EMAIL}")
        self.assertEqual(r.status_code, 400)

    def test_cannot_touch_other_users_list(self):
        other = self.client.get(f"/watchlists/{OTHER_EMAIL}").json()[0]["id"]
        self.client.get(f"/watchlists/{EMAIL}")

        self.assertEqual(
            self.client.patch(f"/watchlists/{other}", json={"user_email": EMAIL, "name": "X"}).status_code,
            404,
        )
        self.assertEqual(
            self.client.delete(f"/watchlists/{other}?user_email={EMAIL}").status_code,
            404,
        )

    def test_reorder(self):
        self.client.get(f"/watchlists/{EMAIL}")
        self.client.post("/watchlists", json={"user_email": EMAIL, "name": "US"})
        self.client.post("/watchlists", json={"user_email": EMAIL, "name": "TW"})

        ids = [w["id"] for w in self.client.get(f"/watchlists/{EMAIL}").json()]
        reversed_ids = list(reversed(ids))
        r = self.client.post("/watchlists/reorder", json={"user_email": EMAIL, "ids": reversed_ids})
        self.assertEqual(r.status_code, 200)

        after = [w["id"] for w in self.client.get(f"/watchlists/{EMAIL}").json()]
        self.assertEqual(after, reversed_ids)


class TestWatchlistStocks(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        _execute("DELETE FROM users WHERE email = %s", (EMAIL,))
        _execute("INSERT INTO users (email, name) VALUES (%s, %s)", (EMAIL, "Watchlist Test"))
        # 一個預設清單 + 兩個自建清單
        self.default_id = self.client.get(f"/watchlists/{EMAIL}").json()[0]["id"]
        self.us_id = self.client.post("/watchlists", json={"user_email": EMAIL, "name": "US"}).json()["id"]
        self.tw_id = self.client.post("/watchlists", json={"user_email": EMAIL, "name": "TW"}).json()["id"]

    def tearDown(self):
        _execute("DELETE FROM users WHERE email = %s", (EMAIL,))

    def test_memberships_roundtrip(self):
        """同一支股票同時加入兩個清單，再讀回歸屬。"""
        r = self.client.put("/watchlist/memberships", json={
            "user_email": EMAIL, "ticker": "AAPL",
            "watchlist_ids": [self.default_id, self.us_id],
        })
        self.assertEqual(r.status_code, 200)

        got = self.client.get(f"/watchlist/memberships/{EMAIL}/AAPL").json()
        self.assertEqual(sorted(got), sorted([self.default_id, self.us_id]))

    def test_memberships_is_full_overwrite(self):
        """未勾選的清單會被移除，勾選的會被加入。"""
        self.client.put("/watchlist/memberships", json={
            "user_email": EMAIL, "ticker": "AAPL",
            "watchlist_ids": [self.default_id, self.us_id],
        })
        self.client.put("/watchlist/memberships", json={
            "user_email": EMAIL, "ticker": "AAPL",
            "watchlist_ids": [self.tw_id],
        })
        got = self.client.get(f"/watchlist/memberships/{EMAIL}/AAPL").json()
        self.assertEqual(got, [self.tw_id])

    def test_memberships_empty_removes_everywhere(self):
        self.client.put("/watchlist/memberships", json={
            "user_email": EMAIL, "ticker": "AAPL", "watchlist_ids": [self.us_id],
        })
        self.client.put("/watchlist/memberships", json={
            "user_email": EMAIL, "ticker": "AAPL", "watchlist_ids": [],
        })
        self.assertEqual(self.client.get(f"/watchlist/memberships/{EMAIL}/AAPL").json(), [])

    def test_memberships_rejects_other_users_list(self):
        _execute("DELETE FROM users WHERE email = %s", (OTHER_EMAIL,))
        _execute("INSERT INTO users (email, name) VALUES (%s, %s)", (OTHER_EMAIL, "Other"))
        try:
            other_id = self.client.get(f"/watchlists/{OTHER_EMAIL}").json()[0]["id"]
            r = self.client.put("/watchlist/memberships", json={
                "user_email": EMAIL, "ticker": "AAPL", "watchlist_ids": [other_id],
            })
            self.assertEqual(r.status_code, 404)
        finally:
            _execute("DELETE FROM users WHERE email = %s", (OTHER_EMAIL,))

    def test_get_stocks_returns_price_fields(self):
        self.client.put("/watchlist/memberships", json={
            "user_email": EMAIL, "ticker": "AAPL", "watchlist_ids": [self.us_id],
        })
        rows = self.client.get(f"/watchlists/{self.us_id}/stocks?user_email={EMAIL}").json()
        self.assertEqual(len(rows), 1)
        for field in ("ticker", "display_order", "price", "prev_close", "price_change",
                      "price_change_percent", "market_state", "extended_price",
                      "extended_type", "extended_change", "extended_change_percent"):
            self.assertIn(field, rows[0])
        self.assertEqual(rows[0]["ticker"], "AAPL")

    def test_get_stocks_rejects_other_user(self):
        r = self.client.get(f"/watchlists/{self.us_id}/stocks?user_email={OTHER_EMAIL}")
        self.assertEqual(r.status_code, 404)

    def test_remove_stock_from_one_list_only(self):
        """從一個清單移除，不影響同一支股票在另一個清單的歸屬。"""
        self.client.put("/watchlist/memberships", json={
            "user_email": EMAIL, "ticker": "AAPL",
            "watchlist_ids": [self.us_id, self.tw_id],
        })
        r = self.client.delete(f"/watchlists/{self.us_id}/stocks/AAPL?user_email={EMAIL}")
        self.assertEqual(r.status_code, 200)

        got = self.client.get(f"/watchlist/memberships/{EMAIL}/AAPL").json()
        self.assertEqual(got, [self.tw_id])

    def test_delete_list_keeps_stock_in_other_list(self):
        self.client.put("/watchlist/memberships", json={
            "user_email": EMAIL, "ticker": "AAPL",
            "watchlist_ids": [self.us_id, self.tw_id],
        })
        self.client.delete(f"/watchlists/{self.us_id}?user_email={EMAIL}")
        got = self.client.get(f"/watchlist/memberships/{EMAIL}/AAPL").json()
        self.assertEqual(got, [self.tw_id])

    def test_reorder_stocks_within_list(self):
        for ticker in ("AAPL", "MSFT", "NVDA"):
            self.client.put("/watchlist/memberships", json={
                "user_email": EMAIL, "ticker": ticker, "watchlist_ids": [self.us_id],
            })
        r = self.client.post(f"/watchlists/{self.us_id}/reorder", json={
            "user_email": EMAIL, "tickers": ["NVDA", "AAPL", "MSFT"],
        })
        self.assertEqual(r.status_code, 200)

        rows = self.client.get(f"/watchlists/{self.us_id}/stocks?user_email={EMAIL}").json()
        self.assertEqual([r_["ticker"] for r_ in rows], ["NVDA", "AAPL", "MSFT"])


if __name__ == "__main__":
    unittest.main()
