# 自選股清單分組（Watchlist Groups）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「一個使用者一份自選股清單」擴充成「一個使用者多份清單、同一支股票可屬於多個清單」，並提供左側抽屜切換／管理清單的 UI。

**Architecture:** 新增 `watchlists` 表，`watchlist_stocks` 加 `watchlist_id` 並把唯一索引從 `(user_email, ticker)` 換成 `(watchlist_id, ticker)`（這一步就是「多重歸屬」）。遷移沿用專案既有的「啟動時 idempotent 建表」慣例，寫在 `app/models/migrations.py` 由 `main.py` 的 lifespan 呼叫，不需手動跑 SQL。後端清單相關端點集中在新的 `app/api/watchlists.py`（不讓已 797 行的 `stock.py` 繼續膨脹），前端清單相關程式碼集中在新的 `static/watchlists.js`。

**Tech Stack:** FastAPI + psycopg2 + PostgreSQL 15；前端為無建置流程的原生 JS（`<script src>` 直接載入，全域函式共享）；測試用 `unittest` + `fastapi.testclient`；前端驗證用 Playwright MCP 實機操作截圖。

## Global Constraints

- **測試指令一律加 `POSTGRES_HOST=localhost`**：`.env` 裡的 `POSTGRES_HOST=postgres` 是給 docker 容器用的，從 host 跑測試連不到。完整指令：`POSTGRES_HOST=localhost .venv/bin/python -m unittest ...`
- **資料庫有真實使用者資料**（4 位使用者、20 筆自選股）。任何 schema 變更必須 idempotent，且不得刪除既有列。
- **回覆與註解使用繁體中文**，符合專案既有風格。
- **前端無建置流程**：不可使用 `import`/`export`、JSX、TypeScript。新檔案用 `<script src="/static/xxx.js">` 載入，函式掛在全域。
- **CSS 只用既有 token**（`var(--card)`、`var(--brand)`、`var(--hairline)`、`var(--text-secondary)`、`var(--radius-card)` 等），不寫死顏色。深色模式靠 token 自動生效，不另寫 `[data-theme="dark"]` 規則，除非該元素需要與 `--card` 不同的底色。
- **每位使用者永遠至少保留一個清單**；預設清單名稱常數 `DEFAULT_WATCHLIST_NAME = "自選股"`。
- **清單名稱**長度 1–50 字，同一使用者不分大小寫不可同名。
- **舊端點在最後一個 Task 才移除**，確保每個 Task 結束時 App 都是可用的。
- **前端改動要驗證必須重建 image**：容器沒有掛載原始碼（Dockerfile 是 `COPY . .`），`docker compose restart` 會拿舊程式碼跑，給出假的通過。一律用 `docker compose up -d --build stockwatch`。
- **實作直接在 `main` 分支進行**（已取得專案擁有者同意）。
- **每個 Task 結束時提交一次 commit**，訊息用專案既有格式（`feat:` / `refactor:` / `experiment:`），並附：
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Ma2mLL7YnYaMAys4ZwQh8y
  ```

## File Structure

**新增：**
| 檔案 | 責任 |
|---|---|
| `app/models/migrations.py` | 啟動時的 idempotent schema 遷移；匯出 `ensure_watchlist_groups()` 與 `DEFAULT_WATCHLIST_NAME` |
| `app/api/watchlists.py` | 清單 CRUD、清單內股票、股票歸屬的所有端點與 DB 存取函式 |
| `static/watchlists.js` | 前端清單狀態、抽屜渲染／開合、管理模式、清單選擇器 |
| `tests/test_migrations.py` | 遷移的 idempotent 與 schema 正確性測試 |
| `tests/test_watchlists.py` | 清單 API 的整合測試（打真實 DB，用專用測試 email） |

**修改：**
| 檔案 | 改什麼 |
|---|---|
| `main.py` | lifespan 呼叫 `ensure_watchlist_groups()`；註冊 `watchlists.router` |
| `app/api/stock.py` | Task 8 移除舊 watchlist 端點與其 `_db_*` 函式；`_db_distinct_watchlist_tickers()` 保留不動 |
| `database/01_create_table.sql` | 新環境初始化即為最終 schema |
| `static/index.html` | nav 標題改為按鈕、加入抽屜與清單選擇器 DOM、載入 `watchlists.js` |
| `static/main.js` | 拖曳邏輯參數化；初始化流程改為先載清單；設定頁刪除／排序改打新端點 |
| `static/styles.css` | 抽屜與清單選擇器樣式（append 到檔尾，與既有模式一致） |

---

### Task 1: 資料庫遷移

把 `watchlists` 表與 `watchlist_stocks.watchlist_id` 建起來，既有資料全部落進各使用者的「自選股」清單，並把唯一索引換成 `(watchlist_id, ticker)` 以解鎖多重歸屬。

**Files:**
- Create: `app/models/migrations.py`
- Create: `tests/test_migrations.py`
- Modify: `main.py`（lifespan 內加一次呼叫）
- Modify: `database/01_create_table.sql`

**Interfaces:**
- Consumes: `app.models.db.get_db_connection()`（既有）
- Produces:
  - `app.models.migrations.DEFAULT_WATCHLIST_NAME: str`（值為 `"自選股"`）
  - `app.models.migrations.ensure_watchlist_groups() -> None`（同步函式，須在 `asyncio.to_thread` 內呼叫）
  - DB schema：`watchlists(id, user_email, name, display_order, created_at, updated_at)`、`watchlist_stocks.watchlist_id NOT NULL`、唯一索引 `idx_unique_watchlist_ticker(watchlist_id, ticker)`

- [ ] **Step 1: 備份資料庫**

資料庫有真實使用者資料，動 schema 前先留一份還原點。

```bash
docker exec stockwatch-postgres-1 pg_dump -U stockwatch stockwatch \
  > /tmp/stockwatch-before-watchlist-groups.sql
wc -l /tmp/stockwatch-before-watchlist-groups.sql
```

預期：檔案行數 > 100。若指令失敗，**停下來回報**，不要繼續。

- [ ] **Step 2: 記錄遷移前的基準數字**

```bash
POSTGRES_HOST=localhost .venv/bin/python -c "
from app.models.db import get_db_connection
c = get_db_connection(); cur = c.cursor()
cur.execute('select count(*) from watchlist_stocks'); print('rows:', cur.fetchone()[0])
cur.execute('select count(distinct user_email) from watchlist_stocks'); print('users:', cur.fetchone()[0])
"
```

把輸出的兩個數字記下來，Step 6 要對照。（撰寫本計畫時為 rows: 20、users: 4。）

- [ ] **Step 3: 寫失敗的測試**

Create `tests/test_migrations.py`：

```python
"""watchlist groups 遷移測試。

打真實資料庫（需 POSTGRES_HOST=localhost）。遷移為 idempotent，
測試在已遷移的資料庫上重複執行也應通過。
"""
import unittest

from app.models.db import get_db_connection
from app.models.migrations import ensure_watchlist_groups, DEFAULT_WATCHLIST_NAME

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

    def test_existing_users_got_default_list(self):
        """遷移前就有自選股的使用者，都拿到一個名為「自選股」的清單。"""
        missing = _query(
            """SELECT COUNT(*) FROM (
                   SELECT DISTINCT user_email FROM watchlist_stocks
               ) u
               WHERE NOT EXISTS (
                   SELECT 1 FROM watchlists w
                   WHERE w.user_email = u.user_email AND w.name = %s
               )""",
            (DEFAULT_WATCHLIST_NAME,),
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
```

- [ ] **Step 4: 執行測試確認失敗**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest tests.test_migrations -v
```

預期：`ModuleNotFoundError: No module named 'app.models.migrations'`

- [ ] **Step 5: 實作遷移**

Create `app/models/migrations.py`：

```python
"""啟動時執行的 idempotent schema 遷移。

沿用 main.py `_ensure_summary_table()` 的慣例：同步函式，於 asyncio.to_thread 內呼叫，
每一步都必須可重複執行而無副作用（資料庫是持久 volume，內有真實使用者資料）。
"""
import logging

from app.models.db import get_db_connection

logger = logging.getLogger(__name__)

# 遷移時給既有使用者建立的預設清單名稱
DEFAULT_WATCHLIST_NAME = "自選股"


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
```

- [ ] **Step 6: 執行測試確認通過，並核對資料筆數**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest tests.test_migrations -v
POSTGRES_HOST=localhost .venv/bin/python -c "
from app.models.db import get_db_connection
c = get_db_connection(); cur = c.cursor()
cur.execute('select count(*) from watchlist_stocks'); print('rows:', cur.fetchone()[0])
cur.execute('select user_email, name, (select count(*) from watchlist_stocks s where s.watchlist_id = w.id) from watchlists w order by user_email')
for r in cur.fetchall(): print(r)
"
```

預期：7 tests OK；`rows` 與 Step 2 記下的數字**完全相同**；每位使用者一列「自選股」清單，股票數加總等於 rows。若筆數不符，**立刻停下來**並用 Step 1 的備份還原。

- [ ] **Step 7: 接上 lifespan**

Modify `main.py`。在既有 import 區塊加入：

```python
from app.models.migrations import ensure_watchlist_groups
```

在 `lifespan` 內、`_ensure_summary_table` 那段之後插入（沿用同樣的「失敗只記 log 不讓 app 崩潰」寫法）：

```python
    # 清單分組遷移（失敗不可讓 app 崩潰）
    try:
        await asyncio.to_thread(ensure_watchlist_groups)
    except Exception as e:
        logger.error(f"watchlist groups 遷移失敗: {e}")
```

- [ ] **Step 8: 更新新環境的初始化 SQL**

Modify `database/01_create_table.sql`。把「建立自選股資料表」那一段整段換成下面內容（新增 watchlists 表、watchlist_stocks 加欄位、唯一索引換掉）：

```sql
-- 建立自選股清單（分組）資料表
CREATE TABLE watchlists (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    name VARCHAR(50) NOT NULL,
    display_order INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_watchlists_user_email
        FOREIGN KEY (user_email)
        REFERENCES users(email)
        ON DELETE CASCADE
);

CREATE INDEX idx_watchlists_user ON watchlists(user_email, display_order);
-- 同一使用者不分大小寫不可有同名清單
CREATE UNIQUE INDEX idx_watchlists_user_name ON watchlists(user_email, lower(name));

-- 建立自選股資料表
CREATE TABLE watchlist_stocks (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    watchlist_id INTEGER NOT NULL,
    ticker VARCHAR(20) NOT NULL,
    display_order INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_email
        FOREIGN KEY (user_email)
        REFERENCES users(email)
        ON DELETE CASCADE,
    CONSTRAINT fk_watchlist_stocks_watchlist
        FOREIGN KEY (watchlist_id)
        REFERENCES watchlists(id)
        ON DELETE CASCADE
);

-- 建立自選股表索引
CREATE INDEX idx_watchlist_stocks_user_email ON watchlist_stocks(user_email);
CREATE INDEX idx_watchlist_stocks_ticker ON watchlist_stocks(ticker);

-- 同一清單內不可重複；不同清單可放同一支股票（多重歸屬）
CREATE UNIQUE INDEX idx_unique_watchlist_ticker ON watchlist_stocks(watchlist_id, ticker);
```

**注意**：`watchlists` 必須定義在 `watchlist_stocks` 之前，否則外鍵參照失敗。

- [ ] **Step 9: 全套測試通過**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest discover -s tests -v
```

預期：15 tests OK（既有 8 + 新增 7）。

- [ ] **Step 10: Commit**

```bash
git add app/models/migrations.py tests/test_migrations.py main.py database/01_create_table.sql
git commit -m "$(cat <<'EOF'
feat(db): 自選股清單分組 schema 與啟動時 idempotent 遷移

新增 watchlists 表，watchlist_stocks 加 watchlist_id，
唯一索引由 (user_email, ticker) 換成 (watchlist_id, ticker) 以支援多重歸屬。
既有自選股自動遷入各使用者的「自選股」預設清單。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ma2mLL7YnYaMAys4ZwQh8y
EOF
)"
```

---

### Task 2: 清單 CRUD API

清單本身的列表／新增／改名／刪除／排序。

**Files:**
- Create: `app/api/watchlists.py`
- Create: `tests/test_watchlists.py`
- Modify: `main.py`（註冊 router）

**Interfaces:**
- Consumes: `app.models.migrations.DEFAULT_WATCHLIST_NAME`、`app.models.db.get_db_connection()`
- Produces（Task 3 會在同一個檔案續加端點，Task 5–7 前端會呼叫）：
  - `GET /watchlists/{user_email}` → `[{id: int, name: str, display_order: int, count: int}]`
  - `POST /watchlists` body `{user_email: str, name: str}` → `{id, name, display_order, count}`
  - `PATCH /watchlists/{watchlist_id}` body `{user_email: str, name: str}` → `{id, name, display_order, count}`
  - `DELETE /watchlists/{watchlist_id}?user_email=` → `{"message": str}`
  - `POST /watchlists/reorder` body `{user_email: str, ids: list[int]}` → `{"message": str}`
  - 內部函式 `_assert_owns(cur, user_email: str, watchlist_id: int) -> None`（Task 3 會用）

- [ ] **Step 1: 寫失敗的測試**

Create `tests/test_watchlists.py`：

```python
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
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest tests.test_watchlists -v
```

預期：全部失敗，狀態碼 404（端點不存在）。

- [ ] **Step 3: 實作 API**

Create `app/api/watchlists.py`：

```python
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
```

**路由順序注意**：`POST /watchlists/reorder` 與 `POST /watchlists` 方法相同但路徑段數不同，不衝突；`GET /watchlists/{user_email}` 與 `PATCH/DELETE /watchlists/{watchlist_id}` 方法不同，也不衝突。

- [ ] **Step 4: 註冊 router**

Modify `main.py`：

```python
from app.api import auth, stock, chat, watchlists
```

```python
app.include_router(watchlists.router, tags=["watchlists"])
```

放在 `app.include_router(stock.router, tags=["stock"])` 之後。

- [ ] **Step 5: 執行測試確認通過**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest tests.test_watchlists -v
```

預期：7 tests OK。

若 `test_cannot_delete_last_list` 失敗且回 200，檢查 `_db_delete_watchlist` 的 `HTTPException` 是否被外層 `try/except` 吃掉——本模組刻意不用 `except Exception` 包住端點。

- [ ] **Step 6: Commit**

```bash
git add app/api/watchlists.py tests/test_watchlists.py main.py
git commit -m "$(cat <<'EOF'
feat(api): 自選股清單 CRUD 端點

清單列表（新使用者 lazy 建立預設清單）、新增、改名、刪除、排序。
同名清單與刪除最後一個清單回 400；跨使用者存取回 404。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ma2mLL7YnYaMAys4ZwQh8y
EOF
)"
```

---

### Task 3: 清單股票與歸屬 API

清單內的股票查詢／排序／移除，以及一支股票的跨清單歸屬讀寫。舊端點此時**不動**。

**Files:**
- Modify: `app/api/watchlists.py`（續加）
- Modify: `tests/test_watchlists.py`（續加測試類別）

**Interfaces:**
- Consumes: Task 2 的 `_assert_owns(cur, user_email, watchlist_id)`、`get_db_connection()`
- Produces（Task 5–7 前端會呼叫）：
  - `GET /watchlists/{watchlist_id}/stocks?user_email=` → 與舊 `/watchlist/{email}` **完全相同的欄位**：`[{ticker, display_order, price, prev_close, price_change, price_change_percent, market_state, extended_price, extended_type, extended_change, extended_change_percent}]`
  - `GET /watchlist/memberships/{user_email}/{ticker}` → `[watchlist_id: int]`
  - `PUT /watchlist/memberships` body `{user_email: str, ticker: str, watchlist_ids: list[int]}` → `{"message": str}`（全量覆蓋）
  - `DELETE /watchlists/{watchlist_id}/stocks/{ticker}?user_email=` → `{"message": str}`
  - `POST /watchlists/{watchlist_id}/reorder` body `{user_email: str, tickers: list[str]}` → `{"message": str}`

- [ ] **Step 1: 寫失敗的測試**

Modify `tests/test_watchlists.py`，在檔案末端 `if __name__` 之前加入：

```python
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
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest tests.test_watchlists.TestWatchlistStocks -v
```

預期：9 tests 失敗（端點不存在，回 404 / KeyError）。

- [ ] **Step 3: 實作端點**

Modify `app/api/watchlists.py`。在檔案末端加入：

```python
class MembershipsRequest(BaseModel):
    user_email: str
    ticker: str
    watchlist_ids: List[int]


class ReorderStocksRequest(BaseModel):
    user_email: str
    tickers: List[str]


# 與 stock.py 的 _WATCHLIST_SQL 同樣的欄位，只是改以 watchlist_id 篩選
_STOCKS_SQL = """
    SELECT
        ws.ticker,
        ws.display_order,
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
    WHERE ws.watchlist_id = %s
    ORDER BY ws.display_order;
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
        for watchlist_id in watchlist_ids:
            cur.execute(
                """INSERT INTO watchlist_stocks (user_email, watchlist_id, ticker, display_order)
                   SELECT %s, %s, %s,
                          COALESCE((SELECT MAX(display_order) + 1 FROM watchlist_stocks
                                    WHERE watchlist_id = %s), 0)
                   WHERE NOT EXISTS (
                       SELECT 1 FROM watchlist_stocks
                       WHERE watchlist_id = %s AND ticker = %s
                   )""",
                (user_email, watchlist_id, ticker, watchlist_id, watchlist_id, ticker),
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
            "DELETE FROM watchlist_stocks WHERE watchlist_id = %s AND ticker = %s",
            (watchlist_id, ticker),
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
                   WHERE watchlist_id = %s AND ticker = %s""",
                (index, watchlist_id, ticker),
            )
        conn.commit()
    finally:
        cur.close()
        conn.close()


@router.get("/watchlists/{watchlist_id}/stocks")
async def get_watchlist_stocks(watchlist_id: int, user_email: str):
    return await asyncio.to_thread(_db_fetch_watchlist_stocks, user_email, watchlist_id)


@router.get("/watchlist/memberships/{user_email}/{ticker}")
async def get_memberships(user_email: str, ticker: str):
    return await asyncio.to_thread(_db_fetch_memberships, user_email, ticker)


@router.put("/watchlist/memberships")
async def set_memberships(request: MembershipsRequest):
    await asyncio.to_thread(
        _db_set_memberships, request.user_email, request.ticker, request.watchlist_ids
    )
    return {"message": "已更新歸屬"}


@router.delete("/watchlists/{watchlist_id}/stocks/{ticker}")
async def remove_stock(watchlist_id: int, ticker: str, user_email: str):
    await asyncio.to_thread(_db_remove_stock, user_email, watchlist_id, ticker)
    return {"message": "已從清單移除"}


@router.post("/watchlists/{watchlist_id}/reorder")
async def reorder_stocks(watchlist_id: int, request: ReorderStocksRequest):
    await asyncio.to_thread(
        _db_reorder_stocks, request.user_email, watchlist_id, request.tickers
    )
    return {"message": "已更新股票順序"}
```

**注意** `POST /watchlists/reorder`（Task 2，清單排序）與 `POST /watchlists/{watchlist_id}/reorder`（本 Task，股票排序）路徑段數不同，不衝突。

- [ ] **Step 4: 執行測試確認通過**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest tests.test_watchlists -v
```

預期：16 tests OK（Task 2 的 7 + 本 Task 的 9）。

- [ ] **Step 5: 全套測試通過**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest discover -s tests -v
```

預期：24 tests OK。

- [ ] **Step 6: Commit**

```bash
git add app/api/watchlists.py tests/test_watchlists.py
git commit -m "$(cat <<'EOF'
feat(api): 清單內股票與跨清單歸屬端點

清單股票查詢/排序/移除，以及以全量覆蓋語意讀寫單一 ticker 的跨清單歸屬。
所有吃 watchlist_id 的端點都驗證擁有者，跨使用者回 404。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ma2mLL7YnYaMAys4ZwQh8y
EOF
)"
```

---

### Task 4: 前端拖曳邏輯參數化（純重構）

現有拖曳寫死 `.settings-row`、`#settingsStockList` 與全域 `stocks`，抽屜的清單排序無法復用。抽成接受 context 的通用版本，**行為完全不變**。

**Files:**
- Modify: `static/main.js:597-768`（TOUCH DRAG 與 MOUSE DRAG 兩段）、`static/main.js:534-538`（設定頁綁定處）

**Interfaces:**
- Produces（Task 6 抽屜排序會用）：
  - `attachDragHandlers(handle: HTMLElement, ctx: {containerId: string, rowSelector: string, onReorder: (fromIndex: number, toIndex: number) => void}) -> void`

- [ ] **Step 1: 加入全域 drag context**

Modify `static/main.js`，在既有的 `let currentTouchItem = null;`（約 line 67）之後加入：

```javascript
let dragCtx = null;        // 目前拖曳的上下文（容器、列選擇器、排序回呼）
```

- [ ] **Step 2: 加入 attachDragHandlers**

Modify `static/main.js`，在 `/* ═══════ TOUCH DRAG ═══════ */` 註解正下方加入：

```javascript
// 把拖曳行為綁到把手上。ctx 描述「拖的是哪個清單」，讓設定頁與清單抽屜共用同一套邏輯。
// ctx = { containerId, rowSelector, onReorder(fromIndex, toIndex) }
function attachDragHandlers(handle, ctx) {
    handle._dragCtx = ctx;
    handle.addEventListener('touchstart', handleTouchStart, { passive: false });
    handle.addEventListener('touchmove', handleTouchMove, { passive: false });
    handle.addEventListener('touchend', handleTouchEnd);
    handle.addEventListener('mousedown', handleMouseDown);
}
```

- [ ] **Step 3: 改寫 handleTouchStart**

把 `handleTouchStart` 內兩處寫死的選擇器改成讀 ctx：

```javascript
function handleTouchStart(e) {
    e.preventDefault();
    e.stopPropagation();

    const touch = e.touches[0];
    const handle = e.target.closest('.drag-handle');
    if (!handle || !handle._dragCtx) return;

    dragCtx = handle._dragCtx;
    const item = handle.closest(dragCtx.rowSelector);
    if (!item) return;

    touchStartY = touch.clientY;
    currentTouchItem = item;
    draggedItemIndex = parseInt(item.dataset.index);

    item.style.position = 'relative';
    item.style.zIndex = '1000';
    item.classList.add('touch-dragging');

    const items = document.getElementById(dragCtx.containerId).querySelectorAll(dragCtx.rowSelector);
    items.forEach(i => {
        if (i !== item) i.style.transition = 'transform 0.3s ease';
    });
}
```

- [ ] **Step 4: 改寫 handleTouchMove**

只改取得 container 與 items 的兩行：

```javascript
    const container = document.getElementById(dragCtx.containerId);
    const items = Array.from(container.querySelectorAll(dragCtx.rowSelector));
```

其餘（`itemHeight`、`currentIndex`、`targetIndex`、`boundedIndex` 的計算與 transform 迴圈）**一字不改**。

- [ ] **Step 5: 改寫 handleTouchEnd**

把取得 container/items 的兩行改成用 ctx，並把「直接操作 stocks 陣列」那段換成呼叫 `onReorder`：

```javascript
function handleTouchEnd() {
    if (!currentTouchItem) return;

    const container = document.getElementById(dragCtx.containerId);
    const items = Array.from(container.querySelectorAll(dragCtx.rowSelector));
    const currentIndex = items.indexOf(currentTouchItem);
    const raw = currentTouchItem.style.transform;
    const moveY = parseFloat(raw.replace('translateY(', '').replace('px)', '') || 0);
    const itemHeight = currentTouchItem.offsetHeight;
    const targetIndex = Math.round(moveY / itemHeight) + currentIndex;
    const boundedIndex = Math.max(0, Math.min(targetIndex, items.length - 1));

    // 先清掉拖曳中的樣式，再交給 onReorder 重繪（重繪會換掉整批 DOM）
    currentTouchItem.style.position = '';
    currentTouchItem.style.zIndex = '';
    currentTouchItem.style.transform = '';
    currentTouchItem.classList.remove('touch-dragging');

    if (boundedIndex !== currentIndex) {
        dragCtx.onReorder(currentIndex, boundedIndex);
    } else {
        items.forEach(item => { item.style.transform = ''; item.style.transition = ''; });
    }

    currentTouchItem = null;
    touchStartY = null;
    draggedItemIndex = null;
    dragCtx = null;
}
```

- [ ] **Step 6: 改寫 handleMouseDown**

同樣三處：開頭取 ctx、`items` 用 ctx、`onMouseUp` 呼叫 `onReorder`。

開頭：

```javascript
function handleMouseDown(e) {
    e.preventDefault();
    const handle = e.target.closest('.drag-handle');
    if (!handle || !handle._dragCtx) return;

    dragCtx = handle._dragCtx;
    const item = handle.closest(dragCtx.rowSelector);
    if (!item) return;

    const startY = e.clientY;
    const ctx = dragCtx;              // 閉包內固定用這份，避免拖曳中被其他把手覆寫
    currentTouchItem = item;
    draggedItemIndex = parseInt(item.dataset.index);

    item.style.position = 'relative';
    item.style.zIndex = '1000';
    item.classList.add('touch-dragging');

    const container = document.getElementById(ctx.containerId);
    const items = Array.from(container.querySelectorAll(ctx.rowSelector));
    items.forEach(i => {
        if (i !== item) i.style.transition = 'transform 0.3s ease';
    });
```

`onMouseMove` 內容不變（items 已是閉包變數）。`onMouseUp` 的收尾改成：

```javascript
        currentTouchItem.style.position = '';
        currentTouchItem.style.zIndex = '';
        currentTouchItem.style.transform = '';
        currentTouchItem.classList.remove('touch-dragging');

        if (boundedIndex !== currentIndex) {
            ctx.onReorder(currentIndex, boundedIndex);
        } else {
            items.forEach(it => { it.style.transform = ''; it.style.transition = ''; });
        }

        currentTouchItem = null;
        draggedItemIndex = null;
        dragCtx = null;
```

（原本 `onMouseUp` 內操作 `stocks` 陣列並呼叫 `renderSettingsStockList/renderStocks/updateStockOrder` 的那段整段刪除，由 `ctx.onReorder` 取代。）

- [ ] **Step 7: 設定頁改用 attachDragHandlers**

Modify `static/main.js` 的 `renderSettingsStockList()`。把原本四行 `handle.addEventListener(...)` 換成：

```javascript
        const handle = row.querySelector('.drag-handle');
        attachDragHandlers(handle, {
            containerId: 'settingsStockList',
            rowSelector: '.settings-row',
            onReorder: (from, to) => {
                const item = stocks[from];
                stocks.splice(from, 1);
                stocks.splice(to, 0, item);
                renderSettingsStockList();
                renderStocks();
                updateStockOrder();
            },
        });
```

- [ ] **Step 8: 驗證行為不變**

重啟容器後用 Playwright MCP 實測：

```bash
docker compose up -d --build stockwatch
```

用 Playwright MCP：
1. `browser_navigate` 到 `http://localhost:8000/home`（若被登入守衛擋下，先在 `browser_evaluate` 內以既有的 `localStorage` 值登入，或直接用瀏覽器已登入的 session）
2. 開設定頁（點右上齒輪 icon）
3. 用 `browser_drag` 把「自選股」區塊第一列的 `.drag-handle` 拖到第三列位置
4. `browser_take_screenshot` 確認順序已改變
5. `browser_navigate` 重新載入頁面，確認新順序有存進資料庫

預期：拖曳排序行為與重構前完全一致。若拖曳無反應，先在 console 檢查 `handle._dragCtx` 是否為 undefined。

- [ ] **Step 9: 全套測試通過**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest discover -s tests -v
```

預期：24 tests OK（此為純前端重構，後端測試應不受影響）。

- [ ] **Step 10: Commit**

```bash
git add static/main.js
git commit -m "$(cat <<'EOF'
refactor(drag): 拖曳邏輯參數化，供設定頁與清單抽屜共用

原本寫死 .settings-row / #settingsStockList / stocks 陣列，
改為由 attachDragHandlers(handle, ctx) 帶入容器、列選擇器與排序回呼。行為不變。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ma2mLL7YnYaMAys4ZwQh8y
EOF
)"
```

---

### Task 5: 抽屜 UI 與切換清單

左上角清單名可點開左側抽屜，選一個清單即切換。此時抽屜只有「切換」，管理功能在 Task 6。

**Files:**
- Create: `static/watchlists.js`
- Modify: `static/index.html`（nav 標題、抽屜 DOM、載入新 script）
- Modify: `static/styles.css`（append 抽屜樣式）
- Modify: `static/main.js`（`initializeStocks`、`updateStockOrder`、`removeStock`、`renderStocks` 空狀態文案）

**Interfaces:**
- Consumes: Task 2 的 `GET /watchlists/{user_email}`、Task 3 的 `GET /watchlists/{id}/stocks`、Task 4 的 `attachDragHandlers`
- Produces（Task 6、7 會用）：
  - 全域 `watchlists: Array<{id, name, display_order, count}>`
  - 全域 `currentWatchlistId: number|null`
  - `getCurrentUserEmail() -> string|null`
  - `loadWatchlists() -> Promise<void>`（載入清單並校正 `currentWatchlistId`）
  - `renderWatchlistDrawer() -> void`
  - `openWatchlistDrawer() / closeWatchlistDrawer() / toggleWatchlistDrawer() -> void`
  - `switchWatchlist(id: number) -> Promise<void>`
  - `updateNavWatchlistName() -> void`
  - `loadCurrentWatchlistStocks() -> Promise<void>`（抓目前清單股票並重繪；定義在 `main.js`）

- [ ] **Step 1: 加入抽屜 DOM**

Modify `static/index.html`。把 `<header class="nav-top">` 內的 `<span class="nav-title">My Stock</span>` 換成：

```html
        <button class="nav-title-btn" onclick="toggleWatchlistDrawer()" aria-label="切換清單">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
            <span class="nav-title" id="navWatchlistName">自選股</span>
            <svg class="nav-title-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
```

在 `<!-- Stock List -->` 那段 `<main>` 之前插入抽屜：

```html
    <!-- Watchlist Drawer -->
    <div id="watchlistDrawerWrap" class="drawer-wrap hidden">
        <aside class="drawer-panel" id="watchlistDrawerPanel">
            <div class="drawer-head">我的清單</div>
            <div id="watchlistDrawerList" class="drawer-list"></div>
            <div class="drawer-foot">
                <button class="drawer-foot-btn" id="drawerManageBtn" onclick="toggleDrawerManageMode()">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
                    管理
                </button>
                <button class="drawer-foot-btn" onclick="showNewWatchlistForm()">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    新增清單
                </button>
            </div>
        </aside>
        <div class="drawer-scrim" onclick="closeWatchlistDrawer()"></div>
    </div>
```

在 `<script src="/static/main.js"></script>` **之前**加入：

```html
    <script src="/static/watchlists.js"></script>
```

（`watchlists.js` 只定義函式與全域變數，不在載入時執行動作，順序不影響；放前面是為了 `main.js` 的 `DOMContentLoaded` 能直接呼叫。）

**注意**：`toggleDrawerManageMode()` 與 `showNewWatchlistForm()` 在 Task 6 才實作。本 Task 先在 `watchlists.js` 放兩個空函式佔位（見 Step 3），避免點擊時 console 報錯。

- [ ] **Step 2: 加入抽屜樣式**

Modify `static/styles.css`，append 到檔案末端：

```css
/* ═══════ NAV TITLE BUTTON ═══════ */

.nav-title-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
  padding: 0;
}

.nav-title-btn:active { opacity: 0.5; }
.nav-title-btn .nav-title-caret { color: var(--text-tertiary); }


/* ═══════ WATCHLIST DRAWER ═══════ */

.drawer-wrap {
  position: fixed;
  inset: 0;
  max-width: 430px;
  margin: 0 auto;
  z-index: 190;
  display: flex;
}

.drawer-panel {
  width: 78%;
  max-width: 320px;
  background: var(--card);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-hero);
  animation: drawerIn 260ms cubic-bezier(.25,.1,.25,1);
}

.drawer-scrim {
  flex: 1;
  background: rgba(0,0,0,0.4);
  animation: scrimIn 260ms ease;
}

@keyframes drawerIn { from { transform: translateX(-100%); } to { transform: none; } }
@keyframes scrimIn  { from { opacity: 0; } to { opacity: 1; } }

.drawer-head {
  font: 700 20px/1.20 var(--font);
  letter-spacing: -0.50px;
  color: var(--text);
  padding: 54px 20px 12px;
}

.drawer-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.drawer-row {
  display: grid;
  grid-template-columns: 3px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 14px 20px 14px 0;
  user-select: none;
  -webkit-user-select: none;
}

.drawer-row + .drawer-row { border-top: 0.5px solid var(--hairline); }
.drawer-row:active { background: var(--well); }

.drawer-row-bar {
  width: 3px;
  height: 20px;
  border-radius: 2px;
  background: transparent;
}

.drawer-row.active .drawer-row-bar { background: var(--brand); }

.drawer-row-name {
  font: 600 16px/1.20 var(--font);
  letter-spacing: -0.32px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-row.active .drawer-row-name { color: var(--brand); }

.drawer-row-count {
  font: 400 13px/1.30 var(--font);
  letter-spacing: -0.08px;
  color: var(--text-tertiary);
}

.drawer-foot {
  display: flex;
  gap: 8px;
  padding: 12px 20px calc(20px + env(safe-area-inset-bottom));
  border-top: 0.5px solid var(--hairline);
}

.drawer-foot-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font: 500 13px/1 var(--font);
  letter-spacing: -0.08px;
  color: var(--brand);
  padding: 9px 0;
  border-radius: var(--radius-pill);
  background: var(--well);
  transition: transform 120ms;
}

.drawer-foot-btn:active { transform: scale(0.96); }
.drawer-foot-btn.active { background: var(--brand); color: #fff; }
```

- [ ] **Step 3: 建立 watchlists.js**

Create `static/watchlists.js`：

```javascript
/* ═══════ WATCHLIST GROUPS ═══════
   清單狀態、左側抽屜、清單管理與清單選擇器。
   無建置流程：函式掛在全域，由 index.html 的 onclick 與 main.js 直接呼叫。 */

let watchlists = [];             // [{id, name, display_order, count}]
let currentWatchlistId = null;   // 目前檢視的清單 id
let drawerManageMode = false;    // 抽屜是否在管理模式（Task 6 使用）

const LS_CURRENT_WATCHLIST = 'sw-current-watchlist';

function getCurrentUserEmail() {
    try {
        const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
        return userInfo.email || null;
    } catch (e) {
        return null;
    }
}

// 載入清單列表，並把 currentWatchlistId 校正到一個實際存在的清單
async function loadWatchlists() {
    const email = getCurrentUserEmail();
    if (!email) throw new Error('找不到使用者資訊');

    const response = await fetch('/watchlists/' + encodeURIComponent(email));
    if (!response.ok) throw new Error('取得清單失敗');
    watchlists = await response.json();

    const saved = parseInt(localStorage.getItem(LS_CURRENT_WATCHLIST));
    const exists = watchlists.some(w => w.id === saved);
    // 記住的清單可能已被刪除，退回第一個
    currentWatchlistId = exists ? saved : (watchlists[0] ? watchlists[0].id : null);
    localStorage.setItem(LS_CURRENT_WATCHLIST, currentWatchlistId);

    updateNavWatchlistName();
}

function getCurrentWatchlist() {
    return watchlists.find(w => w.id === currentWatchlistId) || null;
}

function updateNavWatchlistName() {
    const el = document.getElementById('navWatchlistName');
    if (!el) return;
    const current = getCurrentWatchlist();
    el.textContent = current ? current.name : '自選股';
}

/* ─── 抽屜開合 ─── */

function openWatchlistDrawer() {
    renderWatchlistDrawer();
    document.getElementById('watchlistDrawerWrap').classList.remove('hidden');
}

function closeWatchlistDrawer() {
    document.getElementById('watchlistDrawerWrap').classList.add('hidden');
    drawerManageMode = false;
}

function toggleWatchlistDrawer() {
    const wrap = document.getElementById('watchlistDrawerWrap');
    if (wrap.classList.contains('hidden')) openWatchlistDrawer();
    else closeWatchlistDrawer();
}

/* ─── 抽屜內容 ─── */

function renderWatchlistDrawer() {
    const container = document.getElementById('watchlistDrawerList');
    if (!container) return;
    container.innerHTML = '';

    watchlists.forEach((list, index) => {
        const row = document.createElement('div');
        row.className = 'drawer-row' + (list.id === currentWatchlistId ? ' active' : '');
        row.dataset.index = index;
        row.innerHTML = `
            <div class="drawer-row-bar"></div>
            <div class="drawer-row-name">${escapeHtml(list.name)}</div>
            <div class="drawer-row-count">${list.count}</div>`;
        row.addEventListener('click', () => switchWatchlist(list.id));
        container.appendChild(row);
    });
}

/* ─── 切換清單 ─── */

async function switchWatchlist(id) {
    if (id !== currentWatchlistId) {
        currentWatchlistId = id;
        localStorage.setItem(LS_CURRENT_WATCHLIST, id);
        updateNavWatchlistName();
        await loadCurrentWatchlistStocks();   // 定義在 main.js
    }
    closeWatchlistDrawer();
}

/* ─── Task 6 佔位：管理模式與新增清單 ─── */

function toggleDrawerManageMode() {}
function showNewWatchlistForm() {}
```

- [ ] **Step 4: 改寫 main.js 的初始化與資料載入**

Modify `static/main.js`。把 `initializeStocks()` 整個換成：

```javascript
// 抓目前清單的股票並重繪（切換清單、初始化都走這裡）
async function loadCurrentWatchlistStocks() {
    const email = getCurrentUserEmail();
    if (!email || !currentWatchlistId) { stocks = []; renderStocks(); return; }

    expandedTicker = null;   // 換清單時收合展開中的個股
    renderSkeleton();

    const response = await fetch(
        '/watchlists/' + currentWatchlistId + '/stocks?user_email=' + encodeURIComponent(email)
    );
    if (!response.ok) throw new Error('獲取股票數據失敗');

    stocks = await response.json();
    renderStocks();
    renderSettingsStockList();
    updateStockPrices();
    schedulePoll();
    updateLastUpdateTime();
}

async function initializeStocks() {
    renderSkeleton(); // 資料抵達前先顯示骨架
    try {
        await loadWatchlists();
        await loadCurrentWatchlistStocks();
    } catch (error) {
        console.error('初始化股票數據時發生錯誤:', error);
        stocks = initStockData();
        renderStocks();
        renderSettingsStockList();
    }
}
```

- [ ] **Step 5: 設定頁的刪除與排序改打新端點**

Modify `static/main.js` 的 `removeStock()`，把 fetch 換成：

```javascript
        const response = await fetch(
            '/watchlists/' + currentWatchlistId + '/stocks/' + encodeURIComponent(ticker)
            + '?user_email=' + encodeURIComponent(userInfo.email),
            { method: 'DELETE' }
        );
        if (!response.ok) throw new Error('移除股票失敗');
```

刪除成功後同步更新抽屜計數 —— 在 `renderStocks();` 之後加入：

```javascript
            const list = watchlists.find(w => w.id === currentWatchlistId);
            if (list) list.count = stocks.length;
```

Modify `updateStockOrder()`，把 fetch 換成：

```javascript
        await fetch('/watchlists/' + currentWatchlistId + '/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_email: userInfo.email, tickers: stocks.map(s => s.ticker) })
        });
```

- [ ] **Step 6: 設定頁區塊標題顯示目前清單名**

Modify `static/index.html`，把設定頁的：

```html
            <div class="settings-section-title">自選股</div>
```

換成：

```html
            <div class="settings-section-title" id="settingsListTitle">自選股</div>
```

Modify `static/main.js` 的 `renderSettingsStockList()`，在函式開頭 `container.innerHTML = '';` 之後加入：

```javascript
    const titleEl = document.getElementById('settingsListTitle');
    const current = typeof getCurrentWatchlist === 'function' ? getCurrentWatchlist() : null;
    if (titleEl) titleEl.textContent = current ? current.name : '自選股';
```

- [ ] **Step 7: 空清單文案**

Modify `static/main.js` 的 `renderStocks()` 空狀態區塊，把兩行文案換成：

```javascript
                <div class="empty-state-title">這個清單還沒有股票</div>
                <div class="empty-state-desc">使用下方搜尋列加入股票</div>
```

- [ ] **Step 8: ESC 關閉抽屜**

Modify `static/main.js` 的 `DOMContentLoaded` handler，在既有的 `document.addEventListener('click', ...)` 之後加入：

```javascript
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeWatchlistDrawer();
    });
```

- [ ] **Step 9: 實機驗證**

```bash
docker compose up -d --build stockwatch
```

用 Playwright MCP：
1. 導到 `http://localhost:8000/home`
2. `browser_take_screenshot` — 確認左上角顯示「≡ 自選股 ▾」，股票列表正常顯示
3. 點左上角標題 → `browser_take_screenshot` — 確認抽屜從左滑出，列出清單與股票數，目前清單有藍色左條與藍字
4. 在 console 用 `browser_evaluate` 建立第二個清單並加一支股票：
   ```javascript
   const email = JSON.parse(localStorage.getItem('user_info')).email;
   const r = await fetch('/watchlists', {method:'POST', headers:{'Content-Type':'application/json'},
     body: JSON.stringify({user_email: email, name: 'US'})});
   const w = await r.json();
   await fetch('/watchlist/memberships', {method:'PUT', headers:{'Content-Type':'application/json'},
     body: JSON.stringify({user_email: email, ticker: 'AAPL', watchlist_ids: [w.id]})});
   location.reload();
   ```
5. 開抽屜點「US」→ `browser_take_screenshot` — 確認標題變成「US」、列表只剩 AAPL、抽屜關閉
6. 重新載入頁面 → 確認仍停在「US」（localStorage 記憶生效）
7. 切到空清單 → 確認顯示「這個清單還沒有股票」
8. 開設定頁 → 確認區塊標題顯示目前清單名，刪除與拖曳排序都正常
9. 切換淺色主題 → `browser_take_screenshot` 確認抽屜配色正常

- [ ] **Step 10: 全套測試通過**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest discover -s tests -v
```

預期：24 tests OK。

- [ ] **Step 11: Commit**

```bash
git add static/watchlists.js static/index.html static/styles.css static/main.js
git commit -m "$(cat <<'EOF'
feat(ui): 左側抽屜切換自選股清單

左上角清單名可點開抽屜，列出所有清單與股票數；切換即重載該清單股票，
目前清單記在 localStorage。設定頁區塊標題與空狀態文案改為反映目前清單。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ma2mLL7YnYaMAys4ZwQh8y
EOF
)"
```

---

### Task 6: 抽屜管理模式

抽屜內的新增、改名、刪除、排序清單。

**Files:**
- Modify: `static/watchlists.js`（取代 Task 5 的兩個佔位函式）
- Modify: `static/styles.css`（append 管理模式樣式）

**Interfaces:**
- Consumes: Task 2 的 `POST /watchlists`、`PATCH /watchlists/{id}`、`DELETE /watchlists/{id}`、`POST /watchlists/reorder`；Task 4 的 `attachDragHandlers`；`main.js` 的 `showToast(message)`、`escapeHtml(unsafe)`、`loadCurrentWatchlistStocks()`
- Produces（Task 7 會用）：`refreshWatchlistCounts() -> Promise<void>`

- [ ] **Step 1: 管理模式樣式**

Modify `static/styles.css`，append：

```css
/* ─── 抽屜管理模式 ─── */

.drawer-row.manage {
  grid-template-columns: 3px 1fr auto auto;
}

.drawer-row .drawer-drag {
  width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  cursor: move; touch-action: none;
  color: var(--text-quaternary);
}

.drawer-row .drawer-del {
  width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  color: var(--negative);
  transition: background 0.15s;
}

.drawer-row .drawer-del:active { background: rgba(255,59,48,0.1); }
.drawer-row .drawer-del:disabled { color: var(--text-quaternary); }

.drawer-row.touch-dragging {
  background: var(--card);
  box-shadow: var(--shadow-thumb);
  border-radius: 12px;
  z-index: 1000;
  position: relative;
}

[data-theme="dark"] .drawer-row.touch-dragging { background: #1c1c1e; }

.drawer-name-input {
  font: 600 16px/1.20 var(--font);
  letter-spacing: -0.32px;
  color: var(--text);
  width: 100%;
  padding: 2px 0;
  border-bottom: 1px solid var(--brand);
}

.drawer-new-form {
  padding: 10px 20px 10px 35px;
  border-top: 0.5px solid var(--hairline);
}

.drawer-new-form input {
  font: 600 16px/1.20 var(--font);
  letter-spacing: -0.32px;
  color: var(--text);
  width: 100%;
  padding: 4px 0;
  border-bottom: 1px solid var(--brand);
}
```

- [ ] **Step 2: 加入新增清單的表單 DOM**

Modify `static/index.html`，在 `<div id="watchlistDrawerList" class="drawer-list"></div>` 之後、`<div class="drawer-foot">` 之前插入：

```html
            <div id="watchlistNewForm" class="drawer-new-form hidden">
                <input type="text" id="newWatchlistInput" maxlength="50" placeholder="清單名稱，按 Enter 建立">
            </div>
```

- [ ] **Step 3: 實作管理模式**

Modify `static/watchlists.js`。把 Task 5 末端的兩個佔位函式：

```javascript
function toggleDrawerManageMode() {}
function showNewWatchlistForm() {}
```

整段換成：

```javascript
/* ─── 管理模式 ─── */

function toggleDrawerManageMode() {
    drawerManageMode = !drawerManageMode;
    const btn = document.getElementById('drawerManageBtn');
    if (btn) btn.classList.toggle('active', drawerManageMode);
    hideNewWatchlistForm();
    renderWatchlistDrawer();
}

// 抽屜列：一般模式可點擊切換，管理模式顯示拖曳把手、可點名稱改名、可刪除
function renderWatchlistRow(list, index) {
    const row = document.createElement('div');
    row.className = 'drawer-row'
        + (list.id === currentWatchlistId ? ' active' : '')
        + (drawerManageMode ? ' manage' : '');
    row.dataset.index = index;

    if (!drawerManageMode) {
        row.innerHTML = `
            <div class="drawer-row-bar"></div>
            <div class="drawer-row-name">${escapeHtml(list.name)}</div>
            <div class="drawer-row-count">${list.count}</div>`;
        row.addEventListener('click', () => switchWatchlist(list.id));
        return row;
    }

    const canDelete = watchlists.length > 1;
    row.innerHTML = `
        <div class="drawer-row-bar"></div>
        <div class="drawer-row-name">${escapeHtml(list.name)}</div>
        <div class="drawer-drag">${SVG_DRAG}</div>
        <button type="button" class="drawer-del" ${canDelete ? '' : 'disabled'}>${SVG_DELETE}</button>`;

    row.querySelector('.drawer-row-name').addEventListener('click', () => startRenameWatchlist(list.id));

    const delBtn = row.querySelector('.drawer-del');
    delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (canDelete) deleteWatchlist(list.id);
    });

    attachDragHandlers(row.querySelector('.drawer-drag'), {
        containerId: 'watchlistDrawerList',
        rowSelector: '.drawer-row',
        onReorder: (from, to) => {
            const item = watchlists[from];
            watchlists.splice(from, 1);
            watchlists.splice(to, 0, item);
            renderWatchlistDrawer();
            saveWatchlistOrder();
        },
    });

    return row;
}

async function saveWatchlistOrder() {
    const email = getCurrentUserEmail();
    if (!email) return;
    try {
        await fetch('/watchlists/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_email: email, ids: watchlists.map(w => w.id) }),
        });
    } catch (error) {
        console.error('更新清單順序時發生錯誤:', error);
    }
}

/* ─── 改名 ─── */

function startRenameWatchlist(id) {
    const index = watchlists.findIndex(w => w.id === id);
    if (index < 0) return;

    const row = document.querySelector('.drawer-row[data-index="' + index + '"]');
    if (!row) return;

    const nameEl = row.querySelector('.drawer-row-name');
    const original = watchlists[index].name;
    nameEl.innerHTML = `<input type="text" class="drawer-name-input" maxlength="50" value="${escapeHtml(original)}">`;

    const input = nameEl.querySelector('input');
    input.focus();
    input.select();

    let done = false;
    const commit = async () => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        if (!name || name === original) { renderWatchlistDrawer(); return; }
        await renameWatchlist(id, name);
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { done = true; renderWatchlistDrawer(); }
    });
}

async function renameWatchlist(id, name) {
    const email = getCurrentUserEmail();
    if (!email) return;
    try {
        const response = await fetch('/watchlists/' + id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_email: email, name: name }),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || '改名失敗');
        }
        const updated = await response.json();
        const index = watchlists.findIndex(w => w.id === id);
        if (index >= 0) watchlists[index].name = updated.name;
        updateNavWatchlistName();
    } catch (error) {
        showToast(error.message);
    }
    renderWatchlistDrawer();
}

/* ─── 刪除 ─── */

async function deleteWatchlist(id) {
    const email = getCurrentUserEmail();
    if (!email) return;
    try {
        const response = await fetch(
            '/watchlists/' + id + '?user_email=' + encodeURIComponent(email),
            { method: 'DELETE' }
        );
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || '刪除失敗');
        }
        watchlists = watchlists.filter(w => w.id !== id);
        renderWatchlistDrawer();

        // 刪掉的是目前檢視的清單，退回第一個並重載
        if (id === currentWatchlistId) {
            currentWatchlistId = watchlists[0] ? watchlists[0].id : null;
            localStorage.setItem(LS_CURRENT_WATCHLIST, currentWatchlistId);
            updateNavWatchlistName();
            await loadCurrentWatchlistStocks();
        }
    } catch (error) {
        showToast(error.message);
    }
}

/* ─── 新增 ─── */

function showNewWatchlistForm() {
    const form = document.getElementById('watchlistNewForm');
    const input = document.getElementById('newWatchlistInput');
    if (!form || !input) return;

    form.classList.remove('hidden');
    input.value = '';
    input.focus();

    input.onkeydown = (e) => {
        if (e.key === 'Enter') createWatchlist(input.value.trim());
        if (e.key === 'Escape') hideNewWatchlistForm();
    };
}

function hideNewWatchlistForm() {
    const form = document.getElementById('watchlistNewForm');
    if (form) form.classList.add('hidden');
}

async function createWatchlist(name) {
    const email = getCurrentUserEmail();
    if (!email || !name) return;
    try {
        const response = await fetch('/watchlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_email: email, name: name }),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || '新增清單失敗');
        }
        watchlists.push(await response.json());
        hideNewWatchlistForm();
        renderWatchlistDrawer();
    } catch (error) {
        showToast(error.message);
    }
}

/* ─── 計數同步 ─── */

// 歸屬變動後重抓計數（不動 currentWatchlistId）
async function refreshWatchlistCounts() {
    const email = getCurrentUserEmail();
    if (!email) return;
    try {
        const response = await fetch('/watchlists/' + encodeURIComponent(email));
        if (!response.ok) return;
        watchlists = await response.json();
        updateNavWatchlistName();
    } catch (error) {
        console.error('更新清單計數時發生錯誤:', error);
    }
}
```

- [ ] **Step 4: renderWatchlistDrawer 改用 renderWatchlistRow**

Modify `static/watchlists.js` 的 `renderWatchlistDrawer()`，把 forEach 內容換成：

```javascript
    watchlists.forEach((list, index) => {
        container.appendChild(renderWatchlistRow(list, index));
    });
```

（原本 forEach 內建立 row 的那整段刪除，改由 `renderWatchlistRow` 負責。）

- [ ] **Step 5: 關閉抽屜時收起新增表單**

Modify `static/watchlists.js` 的 `closeWatchlistDrawer()`：

```javascript
function closeWatchlistDrawer() {
    document.getElementById('watchlistDrawerWrap').classList.add('hidden');
    drawerManageMode = false;
    const btn = document.getElementById('drawerManageBtn');
    if (btn) btn.classList.remove('active');
    hideNewWatchlistForm();
}
```

- [ ] **Step 6: 實機驗證**

```bash
docker compose up -d --build stockwatch
```

用 Playwright MCP 逐項確認：
1. 開抽屜 → 點「管理」→ 截圖確認每列出現拖曳把手與刪除鍵、「管理」按鈕變成藍底
2. 點某列名稱 → 變成 input 且已選取 → 輸入新名稱按 Enter → 截圖確認名稱已改，若改的是目前清單，左上角標題同步更新
3. 改名成一個已存在的名稱 → 確認跳出 toast「清單名稱已存在」且名稱回復原狀
4. 拖曳把手調整清單順序 → 重新載入頁面 → 確認順序有存下來
5. 點「新增清單」→ 輸入「TW」按 Enter → 確認新清單出現在列表末端
6. 刪除一個非目前清單 → 確認該列消失
7. 刪除目前正在看的清單 → 確認自動切到第一個清單且股票列表跟著換
8. 刪到只剩一個清單 → 確認刪除鍵變灰且點擊無效
9. 按 ESC → 確認抽屜關閉且管理模式重置

- [ ] **Step 7: 全套測試通過**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest discover -s tests -v
```

預期：24 tests OK。

- [ ] **Step 8: Commit**

```bash
git add static/watchlists.js static/styles.css static/index.html
git commit -m "$(cat <<'EOF'
feat(ui): 抽屜清單管理模式（新增/改名/刪除/排序）

管理模式就地切換，每列出現拖曳把手與刪除鍵，點名稱即改名。
剩最後一個清單時刪除鍵停用；刪掉目前清單會自動退回第一個。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ma2mLL7YnYaMAys4ZwQh8y
EOF
)"
```

---

### Task 7: 清單選擇器（加入股票時多選清單）

點搜尋結果不再直接加入，改為彈出可多選的清單選擇器。

**Files:**
- Modify: `static/index.html`（選擇器 DOM）
- Modify: `static/styles.css`（append 選擇器樣式）
- Modify: `static/watchlists.js`（選擇器邏輯）
- Modify: `static/main.js`（搜尋結果的 onclick、移除舊的 `addToWatchlist`）

**Interfaces:**
- Consumes: Task 3 的 `GET /watchlist/memberships/{user_email}/{ticker}`、`PUT /watchlist/memberships`；Task 6 的 `refreshWatchlistCounts()`；`main.js` 的 `loadCurrentWatchlistStocks()`、`showToast()`、`escapeHtml()`
- Produces: `openListPicker(ticker: string) -> Promise<void>`、`closeListPicker() -> void`、`submitListPicker() -> Promise<void>`

- [ ] **Step 1: 選擇器 DOM**

Modify `static/index.html`，在 `<!-- Settings Sheet -->` 之前插入：

```html
    <!-- 清單選擇器 -->
    <div id="listPickerWrap" class="picker-wrap hidden">
        <div class="picker-scrim" onclick="closeListPicker()"></div>
        <div class="picker-sheet">
            <div class="picker-head">
                <span class="picker-title">加入清單</span>
                <span class="picker-ticker" id="pickerTicker"></span>
            </div>
            <div id="pickerList" class="picker-list"></div>
            <div class="picker-foot">
                <button class="pill-btn pill-btn-secondary" onclick="closeListPicker()">取消</button>
                <button class="pill-btn pill-btn-primary" onclick="submitListPicker()">完成</button>
            </div>
        </div>
    </div>
```

- [ ] **Step 2: 選擇器樣式**

Modify `static/styles.css`，append：

```css
/* ═══════ LIST PICKER ═══════ */

.picker-wrap {
  position: fixed;
  inset: 0;
  max-width: 430px;
  margin: 0 auto;
  z-index: 210;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.picker-scrim {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.4);
  animation: scrimIn 240ms ease;
}

.picker-sheet {
  position: relative;
  background: var(--card);
  border-radius: var(--radius-card) var(--radius-card) 0 0;
  padding-bottom: env(safe-area-inset-bottom);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  animation: pickerIn 280ms cubic-bezier(.25,.1,.25,1);
}

@keyframes pickerIn { from { transform: translateY(100%); } to { transform: none; } }

.picker-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 18px 20px 12px;
}

.picker-title {
  font: 700 20px/1.20 var(--font);
  letter-spacing: -0.50px;
  color: var(--text);
}

.picker-ticker {
  font: 400 13px/1.30 var(--font);
  letter-spacing: -0.08px;
  color: var(--text-secondary);
}

.picker-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.picker-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 20px;
}

.picker-row + .picker-row { border-top: 0.5px solid var(--hairline); }
.picker-row:active { background: var(--well); }

.picker-row-name {
  font: 600 16px/1.20 var(--font);
  letter-spacing: -0.32px;
  color: var(--text);
}

.picker-check {
  width: 22px; height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--text-quaternary);
  display: flex; align-items: center; justify-content: center;
  color: transparent;
  flex-shrink: 0;
}

.picker-row.checked .picker-check {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

.picker-foot {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 12px 20px 16px;
  border-top: 0.5px solid var(--hairline);
}
```

- [ ] **Step 3: 選擇器邏輯**

Modify `static/watchlists.js`，append 到檔案末端：

```javascript
/* ═══════ 清單選擇器 ═══════ */

let pickerTicker = null;        // 目前正在編輯歸屬的代號
let pickerSelected = new Set(); // 勾選中的清單 id

const SVG_CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

// 開啟選擇器；預先勾選該股票目前所屬的清單
async function openListPicker(ticker) {
    const email = getCurrentUserEmail();
    if (!email) return;

    pickerTicker = ticker;
    pickerSelected = new Set();

    try {
        const response = await fetch(
            '/watchlist/memberships/' + encodeURIComponent(email) + '/' + encodeURIComponent(ticker)
        );
        if (response.ok) {
            (await response.json()).forEach(id => pickerSelected.add(id));
        }
    } catch (error) {
        console.error('取得歸屬時發生錯誤:', error);
    }

    // 尚未屬於任何清單時，預設勾選目前正在看的清單
    if (!pickerSelected.size && currentWatchlistId) pickerSelected.add(currentWatchlistId);

    document.getElementById('pickerTicker').textContent = ticker;
    renderListPicker();
    document.getElementById('listPickerWrap').classList.remove('hidden');
}

function renderListPicker() {
    const container = document.getElementById('pickerList');
    if (!container) return;
    container.innerHTML = '';

    watchlists.forEach(list => {
        const checked = pickerSelected.has(list.id);
        const row = document.createElement('div');
        row.className = 'picker-row' + (checked ? ' checked' : '');
        row.innerHTML = `
            <span class="picker-row-name">${escapeHtml(list.name)}</span>
            <span class="picker-check">${SVG_CHECK}</span>`;
        row.addEventListener('click', () => {
            if (pickerSelected.has(list.id)) pickerSelected.delete(list.id);
            else pickerSelected.add(list.id);
            renderListPicker();
        });
        container.appendChild(row);
    });
}

function closeListPicker() {
    document.getElementById('listPickerWrap').classList.add('hidden');
    pickerTicker = null;
    pickerSelected = new Set();
}

async function submitListPicker() {
    const email = getCurrentUserEmail();
    const ticker = pickerTicker;
    if (!email || !ticker) { closeListPicker(); return; }

    const ids = Array.from(pickerSelected);
    const affectsCurrent = ids.includes(currentWatchlistId);
    closeListPicker();

    try {
        const response = await fetch('/watchlist/memberships', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_email: email, ticker: ticker, watchlist_ids: ids }),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || '更新歸屬失敗');
        }

        await refreshWatchlistCounts();
        // 影響到目前清單才需要重載股票列表
        if (affectsCurrent || !ids.length) await loadCurrentWatchlistStocks();

        showToast(ids.length ? '已加入 ' + ids.length + ' 個清單' : '已從所有清單移除');
    } catch (error) {
        showToast(error.message);
    }
}
```

- [ ] **Step 4: 搜尋結果改開選擇器**

Modify `static/main.js` 的搜尋結果建立處（`DOMContentLoaded` 內 `results.forEach`），把：

```javascript
                    item.onclick = () => addToWatchlist(stock.symbol);
```

換成：

```javascript
                    item.onclick = () => {
                        document.getElementById('searchResults').classList.add('hidden');
                        document.getElementById('searchInput').value = '';
                        openListPicker(stock.symbol);
                    };
```

- [ ] **Step 5: 移除已無用的 addToWatchlist**

Modify `static/main.js`，把整個 `addToWatchlist(ticker)` 函式刪除（唯一呼叫處已在 Step 4 換掉）。

- [ ] **Step 6: 實機驗證**

```bash
docker compose up -d --build stockwatch
```

用 Playwright MCP：
1. 在搜尋列輸入 `NVDA` → 點結果 → 截圖確認底部彈出選擇器，標題「加入清單」、右側顯示 NVDA、目前清單已預先勾選
2. 勾選另外兩個清單 → 點「完成」→ 確認 toast 顯示「已加入 3 個清單」、股票出現在目前清單、抽屜計數同步增加
3. 再次搜尋 `NVDA` 並點擊 → 確認三個清單都是勾選狀態（歸屬讀回正確）
4. 取消勾選目前清單 → 完成 → 確認該股票從目前清單列表消失，但切到別的清單仍在
5. 全部取消勾選 → 完成 → 確認 toast 顯示「已從所有清單移除」，各清單都查不到該股票
6. 點選擇器外的遮罩 → 確認關閉且未送出變更
7. 切換淺色主題 → 截圖確認選擇器配色正常

- [ ] **Step 7: 全套測試通過**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest discover -s tests -v
```

預期：24 tests OK。

- [ ] **Step 8: Commit**

```bash
git add static/index.html static/styles.css static/watchlists.js static/main.js
git commit -m "$(cat <<'EOF'
feat(ui): 加入股票時以清單選擇器多選歸屬

點搜尋結果改為彈出底部選擇器，預先勾選該股票目前所屬清單，
確認後以全量覆蓋語意寫回歸屬，並同步抽屜計數與目前清單列表。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ma2mLL7YnYaMAys4ZwQh8y
EOF
)"
```

---

### Task 8: 移除舊端點

前端已全數改用新端點，把 `stock.py` 內已無人呼叫的舊 watchlist 端點與其 DB 函式刪掉。

**Files:**
- Modify: `app/api/stock.py`（移除 4 個端點、4 個 `_db_*` 函式、`_WATCHLIST_SQL`、`ReorderRequest`）
- Modify: `tests/test_watchlists.py`（加一個確認舊端點已消失的測試）

**Interfaces:**
- Consumes: 無新增
- Produces: 無新增（純移除）

- [ ] **Step 1: 確認沒有殘留呼叫**

```bash
grep -rn "watchlist/add\|/watchlist/' + \|watchlist/reorder" static/ || echo "前端已無舊端點呼叫"
```

預期輸出：`前端已無舊端點呼叫`。若有殘留，先回到對應 Task 修正，**不要繼續**。

- [ ] **Step 2: 寫失敗的測試**

Modify `tests/test_watchlists.py`，在 `TestWatchlistStocks` 之後、`if __name__` 之前加入：

```python
class TestLegacyEndpointsRemoved(unittest.TestCase):
    """舊的單一清單端點已移除，避免與新的清單端點語意衝突。"""

    def setUp(self):
        self.client = TestClient(app)

    def test_legacy_routes_gone(self):
        paths = {getattr(r, "path", "") for r in app.routes}
        self.assertNotIn("/watchlist/{user_email}", paths)
        self.assertNotIn("/watchlist/add", paths)
        self.assertNotIn("/watchlist/{user_email}/{ticker}", paths)
        self.assertNotIn("/watchlist/reorder", paths)

    def test_new_routes_present(self):
        paths = {getattr(r, "path", "") for r in app.routes}
        self.assertIn("/watchlists/{user_email}", paths)
        self.assertIn("/watchlists/{watchlist_id}/stocks", paths)
        self.assertIn("/watchlist/memberships", paths)
```

- [ ] **Step 3: 執行測試確認失敗**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest tests.test_watchlists.TestLegacyEndpointsRemoved -v
```

預期：`test_legacy_routes_gone` FAIL（舊路由還在），`test_new_routes_present` PASS。

- [ ] **Step 4: 移除舊程式碼**

Modify `app/api/stock.py`，刪除下列項目：

- `_WATCHLIST_SQL` 常數
- `_db_fetch_watchlist(user_email)`
- `_db_add_watchlist(user_email, ticker)`
- `_db_remove_watchlist(user_email, ticker)`
- `_db_reorder_watchlist(user_email, tickers)`
- `@router.get("/watchlist/{user_email}")` 的 `get_watchlist`
- `@router.post("/watchlist/add")` 的 `add_to_watchlist`
- `@router.delete("/watchlist/{user_email}/{ticker}")` 的 `remove_from_watchlist`
- `@router.post("/watchlist/reorder")` 的 `reorder_watchlist`
- `class ReorderRequest(BaseModel)`

**保留不動**：
- `_db_distinct_watchlist_tickers()` —— 排程 `_refresh_all_summaries` 仍在用，且它是全域 distinct ticker，不受分組影響
- `_db_upsert_stock_price()`、`_UPSERT_STOCK_SQL` 與其餘所有端點

移除 `ReorderRequest` 後檢查 `from typing import List` 與 `from pydantic import BaseModel` 是否還有其他使用者：

```bash
grep -n "BaseModel\|List\[" app/api/stock.py
```

若已無使用，把對應的 import 一併刪除（只清掉自己造成的孤兒 import）。

- [ ] **Step 5: 執行測試確認通過**

```bash
POSTGRES_HOST=localhost .venv/bin/python -m unittest discover -s tests -v
```

預期：26 tests OK。

- [ ] **Step 6: 端到端回歸**

```bash
docker compose up -d --build stockwatch
```

用 Playwright MCP 走一遍完整流程，確認移除舊端點沒有打破任何既有功能：
1. 載入首頁 → 股票列表、價格、盤前盤後、市場儀表板正常
2. 點股票列 → 基本面展開、AI 摘要正常
3. 開抽屜切換清單 → 正常
4. 管理模式改名、排序、刪除 → 正常
5. 搜尋加入股票（多選清單）→ 正常
6. 設定頁刪除與拖曳排序 → 正常
7. 主題切換淺色／深色 → 全部畫面正常

- [ ] **Step 7: Commit**

```bash
git add app/api/stock.py tests/test_watchlists.py
git commit -m "$(cat <<'EOF'
refactor(api): 移除已被清單端點取代的舊 watchlist 路由

前端已全數改用 /watchlists 系列端點，刪除 stock.py 內的單一清單端點與其 DB 函式。
_db_distinct_watchlist_tickers 保留（排程摘要仍在用，不受分組影響）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ma2mLL7YnYaMAys4ZwQh8y
EOF
)"
```

---

## 驗收對照（對應 spec 的「驗證」節）

全部 Task 完成後逐項確認：

- [ ] 遷移 idempotent，執行兩次資料筆數不變（Task 1 Step 6）
- [ ] 既有自選股全數落在「自選股」清單，筆數與遷移前相同（Task 1 Step 6）
- [ ] 清單 CRUD、reorder 正常（Task 2 測試）
- [ ] memberships 全量覆蓋：加入／移除／同一 ticker 跨兩清單（Task 3 測試）
- [ ] 刪最後一個清單回 400（Task 2 測試）
- [ ] 跨使用者存取 watchlist_id 回 404（Task 2、3 測試）
- [ ] 抽屜開合、切換清單、管理模式拖曳與改名、清單選擇器多選、空清單狀態（Task 5–7 Playwright 驗證）
- [ ] `tests/test_main.py` 既有 8 個測試全數通過
