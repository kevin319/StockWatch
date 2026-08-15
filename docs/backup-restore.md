# 資料庫備份與還原

## 備份怎麼跑

自動的，不需要手動介入：

- **App 啟動時**跑一次（確保隨時都有一份近期備份，設定壞掉也會立刻在 log 曝光）
- **每天 03:00（台北時間）**跑一次，由 `main.py` 的 APScheduler 排程

備份檔寫到 host 的 `backups/`（由 `docker-compose.yml` 掛載為容器內的 `/backups`）。
放 host 是刻意的——寫在容器內或資料庫 volume 內的備份，volume 掛掉時會一起消失。

保留最近 **30 份**，超過的自動刪除。單份約 9 KB（gzip）。

程式在 `app/models/backup.py`。

## 手動備份

```bash
docker exec stockwatch-stockwatch-1 python -m app.models.backup
```

## 還原

**還原一律加 `ON_ERROR_STOP=1`**，否則 psql 會跳過錯誤繼續跑，你會得到一個看似成功
但其實殘缺的資料庫。

還原到一個新資料庫先驗證（建議做法，不會動到現行資料）：

```bash
BK=backups/stockwatch-YYYYMMDD-HHMMSS.sql.gz

docker exec stockwatch-postgres-1 psql -U stockwatch -d postgres -c "CREATE DATABASE restore_test;"
gzcat "$BK" | docker exec -i stockwatch-postgres-1 psql -U stockwatch -d restore_test -v ON_ERROR_STOP=1

# 比對筆數
for T in users watchlists watchlist_stocks stock_prices stock_summaries; do
  echo -n "$T: "
  docker exec stockwatch-postgres-1 psql -U stockwatch -d restore_test -tAc "select count(*) from $T"
done
```

確認無誤後才覆蓋正式資料庫：

```bash
docker compose stop stockwatch          # 先停 App，避免還原中途有寫入
docker exec stockwatch-postgres-1 psql -U stockwatch -d postgres -c "DROP DATABASE stockwatch;"
docker exec stockwatch-postgres-1 psql -U stockwatch -d postgres -c "CREATE DATABASE stockwatch;"
gzcat "$BK" | docker exec -i stockwatch-postgres-1 psql -U stockwatch -d stockwatch -v ON_ERROR_STOP=1
docker compose start stockwatch
```

## 為什麼 Dockerfile 釘 bookworm

`pg_dump` 的主版本必須與 server（postgres:15）一致。`python:3.11-slim` 這個浮動標籤
已經跳到 Debian 13（trixie），它的 client 是 17；17 產出的 dump 帶有 PG 15 不認得的
`transaction_timeout` 設定，還原時加上 `ON_ERROR_STOP=1` 會直接中止。

釘 `python:3.11-slim-bookworm` 拿到 client 15，與 server 對齊。**升級 postgres 主版本時，
這個基底也要跟著換。**

## 已知限制

備份與資料庫在同一台機器上。這能救「volume 損毀 / 誤刪 / 遷移寫壞」，
但**救不了整台機器損毀**。真要防那個，得把 `backups/` 同步到別的地方
（外接硬碟、NAS、雲端儲存皆可）。
