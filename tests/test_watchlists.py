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


if __name__ == "__main__":
    unittest.main()
