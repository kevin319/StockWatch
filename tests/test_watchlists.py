"""清單 API 整合測試。打真實資料庫（需 POSTGRES_HOST=localhost）。

用專用測試 email，setUp/tearDown 自行清理，不碰真實使用者資料。
所有端點都需要登入，身分一律由 Bearer token 推導，故測試用 _client_for() 取得帶憑證的 client。
"""
import unittest
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from jose import jwt

from main import app
from app.core.config import settings
from app.models.db import get_db_connection

EMAIL = "watchlist-api-test@example.com"
OTHER_EMAIL = "watchlist-api-other@example.com"


def _token_for(email: str) -> str:
    """簽一個與 auth.py 同格式的 app JWT。"""
    claims = {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    return jwt.encode(claims, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _client_for(email: str) -> TestClient:
    return TestClient(app, headers={"Authorization": f"Bearer {_token_for(email)}"})


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
        self.client = _client_for(EMAIL)
        self.other_client = _client_for(OTHER_EMAIL)
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
        r = self.client.get("/watchlists")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["name"], "自選股")
        self.assertEqual(data[0]["count"], 0)
        self.assertIsInstance(data[0]["id"], int)

    def test_create_rename_delete(self):
        self.client.get("/watchlists")  # 先有預設清單

        r = self.client.post("/watchlists", json={"name": "US"})
        self.assertEqual(r.status_code, 200)
        wid = r.json()["id"]
        self.assertEqual(r.json()["name"], "US")

        r = self.client.patch(f"/watchlists/{wid}", json={"name": "美股"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["name"], "美股")

        r = self.client.delete(f"/watchlists/{wid}")
        self.assertEqual(r.status_code, 200)

        names = [w["name"] for w in self.client.get("/watchlists").json()]
        self.assertEqual(names, ["自選股"])

    def test_duplicate_name_rejected(self):
        self.client.get("/watchlists")
        self.client.post("/watchlists", json={"name": "US"})
        r = self.client.post("/watchlists", json={"name": "us"})
        self.assertEqual(r.status_code, 400)

    def test_blank_name_rejected(self):
        self.client.get("/watchlists")
        r = self.client.post("/watchlists", json={"name": "   "})
        self.assertEqual(r.status_code, 400)

    def test_cannot_delete_last_list(self):
        lists = self.client.get("/watchlists").json()
        r = self.client.delete(f"/watchlists/{lists[0]['id']}")
        self.assertEqual(r.status_code, 400)

    def test_cannot_touch_other_users_list(self):
        other = self.other_client.get("/watchlists").json()[0]["id"]
        self.client.get("/watchlists")

        self.assertEqual(
            self.client.patch(f"/watchlists/{other}", json={"name": "X"}).status_code,
            404,
        )
        self.assertEqual(
            self.client.delete(f"/watchlists/{other}").status_code,
            404,
        )

    def test_reorder(self):
        self.client.get("/watchlists")
        self.client.post("/watchlists", json={"name": "US"})
        self.client.post("/watchlists", json={"name": "TW"})

        ids = [w["id"] for w in self.client.get("/watchlists").json()]
        reversed_ids = list(reversed(ids))
        r = self.client.post("/watchlists/reorder", json={"ids": reversed_ids})
        self.assertEqual(r.status_code, 200)

        after = [w["id"] for w in self.client.get("/watchlists").json()]
        self.assertEqual(after, reversed_ids)


class TestWatchlistStocks(unittest.TestCase):
    def setUp(self):
        self.client = _client_for(EMAIL)
        self.other_client = _client_for(OTHER_EMAIL)
        _execute("DELETE FROM users WHERE email = %s", (EMAIL,))
        _execute("INSERT INTO users (email, name) VALUES (%s, %s)", (EMAIL, "Watchlist Test"))
        # 一個預設清單 + 兩個自建清單
        self.default_id = self.client.get("/watchlists").json()[0]["id"]
        self.us_id = self.client.post("/watchlists", json={"name": "US"}).json()["id"]
        self.tw_id = self.client.post("/watchlists", json={"name": "TW"}).json()["id"]

    def tearDown(self):
        _execute("DELETE FROM users WHERE email = %s", (EMAIL,))

    def test_memberships_roundtrip(self):
        """同一支股票同時加入兩個清單，再讀回歸屬。"""
        r = self.client.put("/watchlist/memberships", json={
            "ticker": "AAPL",
            "watchlist_ids": [self.default_id, self.us_id],
        })
        self.assertEqual(r.status_code, 200)

        got = self.client.get("/watchlist/memberships/AAPL").json()
        self.assertEqual(sorted(got), sorted([self.default_id, self.us_id]))

    def test_memberships_is_full_overwrite(self):
        """未勾選的清單會被移除，勾選的會被加入。"""
        self.client.put("/watchlist/memberships", json={
            "ticker": "AAPL",
            "watchlist_ids": [self.default_id, self.us_id],
        })
        self.client.put("/watchlist/memberships", json={
            "ticker": "AAPL",
            "watchlist_ids": [self.tw_id],
        })
        got = self.client.get("/watchlist/memberships/AAPL").json()
        self.assertEqual(got, [self.tw_id])

    def test_memberships_empty_removes_everywhere(self):
        self.client.put("/watchlist/memberships", json={
            "ticker": "AAPL", "watchlist_ids": [self.us_id],
        })
        self.client.put("/watchlist/memberships", json={
            "ticker": "AAPL", "watchlist_ids": [],
        })
        self.assertEqual(self.client.get("/watchlist/memberships/AAPL").json(), [])

    def test_memberships_rejects_other_users_list(self):
        _execute("DELETE FROM users WHERE email = %s", (OTHER_EMAIL,))
        _execute("INSERT INTO users (email, name) VALUES (%s, %s)", (OTHER_EMAIL, "Other"))
        try:
            other_id = _client_for(OTHER_EMAIL).get("/watchlists").json()[0]["id"]
            r = self.client.put("/watchlist/memberships", json={
                "ticker": "AAPL", "watchlist_ids": [other_id],
            })
            self.assertEqual(r.status_code, 404)
        finally:
            _execute("DELETE FROM users WHERE email = %s", (OTHER_EMAIL,))

    def test_get_stocks_returns_price_fields(self):
        self.client.put("/watchlist/memberships", json={
            "ticker": "AAPL", "watchlist_ids": [self.us_id],
        })
        rows = self.client.get(f"/watchlists/{self.us_id}/stocks").json()
        self.assertEqual(len(rows), 1)
        for field in ("ticker", "display_order", "price", "prev_close", "price_change",
                      "price_change_percent", "market_state", "extended_price",
                      "extended_type", "extended_change", "extended_change_percent"):
            self.assertIn(field, rows[0])
        self.assertEqual(rows[0]["ticker"], "AAPL")

    def test_get_stocks_rejects_other_user(self):
        """別的登入者拿著自己的 token 也讀不到我的清單。"""
        _execute("DELETE FROM users WHERE email = %s", (OTHER_EMAIL,))
        _execute("INSERT INTO users (email, name) VALUES (%s, %s)", (OTHER_EMAIL, "Other"))
        try:
            r = _client_for(OTHER_EMAIL).get(f"/watchlists/{self.us_id}/stocks")
            self.assertEqual(r.status_code, 404)
        finally:
            _execute("DELETE FROM users WHERE email = %s", (OTHER_EMAIL,))

    def test_remove_stock_from_one_list_only(self):
        """從一個清單移除，不影響同一支股票在另一個清單的歸屬。"""
        self.client.put("/watchlist/memberships", json={
            "ticker": "AAPL",
            "watchlist_ids": [self.us_id, self.tw_id],
        })
        r = self.client.delete(f"/watchlists/{self.us_id}/stocks/AAPL")
        self.assertEqual(r.status_code, 200)

        got = self.client.get("/watchlist/memberships/AAPL").json()
        self.assertEqual(got, [self.tw_id])

    def test_delete_list_keeps_stock_in_other_list(self):
        self.client.put("/watchlist/memberships", json={
            "ticker": "AAPL",
            "watchlist_ids": [self.us_id, self.tw_id],
        })
        self.client.delete(f"/watchlists/{self.us_id}")
        got = self.client.get("/watchlist/memberships/AAPL").json()
        self.assertEqual(got, [self.tw_id])

    def test_reorder_stocks_within_list(self):
        for ticker in ("AAPL", "MSFT", "NVDA"):
            self.client.put("/watchlist/memberships", json={
                "ticker": ticker, "watchlist_ids": [self.us_id],
            })
        r = self.client.post(f"/watchlists/{self.us_id}/reorder", json={
            "tickers": ["NVDA", "AAPL", "MSFT"],
        })
        self.assertEqual(r.status_code, 200)

        rows = self.client.get(f"/watchlists/{self.us_id}/stocks").json()
        self.assertEqual([r_["ticker"] for r_ in rows], ["NVDA", "AAPL", "MSFT"])


class TestLegacyEndpointsRemoved(unittest.TestCase):
    """舊的單一清單端點已移除，避免與新的清單端點語意衝突。"""

    def setUp(self):
        self.client = _client_for(EMAIL)
        self.other_client = _client_for(OTHER_EMAIL)

    def _route_paths(self):
        # 這個 FastAPI 版本的 include_router 是 lazy 解析（_IncludedRouter
        # wrapper），app.routes 內巢狀路由的 .path 不會直接攤平，故改用
        # app.openapi() 產生的 schema 取得攤平後的實際路徑集合。
        return set(app.openapi()["paths"].keys())

    def test_legacy_routes_gone(self):
        paths = self._route_paths()
        self.assertNotIn("/watchlist/{user_email}", paths)
        self.assertNotIn("/watchlist/add", paths)
        self.assertNotIn("/watchlist/{user_email}/{ticker}", paths)
        self.assertNotIn("/watchlist/reorder", paths)

    def test_new_routes_present(self):
        paths = self._route_paths()
        self.assertIn("/watchlists", paths)
        self.assertIn("/watchlists/{watchlist_id}/stocks", paths)
        self.assertIn("/watchlist/memberships", paths)
        # 身分改由 token 推導後，路徑不該再帶 user_email
        self.assertNotIn("/watchlists/{user_email}", paths)
        self.assertNotIn("/watchlist/memberships/{user_email}/{ticker}", paths)


if __name__ == "__main__":
    unittest.main()


class TestAuthRequired(unittest.TestCase):
    """所有使用者資料端點都必須登入；未帶或帶壞 token 一律 401。"""

    def setUp(self):
        self.anon = TestClient(app)  # 不帶 Authorization

    def test_no_token_rejected(self):
        for path in ["/watchlists", "/watchlists/1/stocks",
                     "/watchlist/memberships/AAPL", "/stockprice/AAPL",
                     "/autocomplete/apple", "/fundamentals/AAPL",
                     "/sparkline/AAPL", "/stock/AAPL", "/ai-summary/AAPL"]:
            with self.subTest(path=path):
                self.assertEqual(self.anon.get(path).status_code, 401, f"GET {path} 應回 401")

        for method, path in [("post", "/watchlists"), ("put", "/watchlist/memberships"),
                             ("post", "/watchlists/reorder")]:
            with self.subTest(path=path):
                r = getattr(self.anon, method)(path, json={})
                self.assertEqual(r.status_code, 401, f"{method.upper()} {path} 應回 401")

    def test_garbage_token_rejected(self):
        c = TestClient(app, headers={"Authorization": "Bearer not-a-real-token"})
        self.assertEqual(c.get("/watchlists").status_code, 401)

    def test_expired_token_rejected(self):
        claims = {"sub": EMAIL, "exp": datetime.now(timezone.utc) - timedelta(hours=1)}
        expired = jwt.encode(claims, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
        c = TestClient(app, headers={"Authorization": f"Bearer {expired}"})
        self.assertEqual(c.get("/watchlists").status_code, 401)

    def test_version_endpoint_is_public(self):
        """版本端點供舊分頁自我偵測，必須不需登入。"""
        r = self.anon.get("/version")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get("version"))
