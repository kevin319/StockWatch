"""資料庫備份：pg_dump 邏輯備份 + 自動輪替。

設計取捨：
- 用 pg_dump 而非 volume 快照——可攜、可讀、可還原到任何 PostgreSQL。
- 寫到 BACKUP_DIR（掛載到 host 的目錄）。寫在容器內或 db volume 內等於沒備份，
  volume 掛掉時備份會一起陪葬。
- 跑在 App 既有的 APScheduler 裡，不另外開 cron/launchd：備份機制跟著 repo 走，
  換機器部署不會忘了帶，也不依賴主機排程器。
"""
import gzip
import logging
import os
import subprocess
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

BACKUP_DIR = Path(os.getenv("BACKUP_DIR", "/backups"))
KEEP_COUNT = 30  # 保留最近幾份（含每日與每次啟動產生的）
FILE_PREFIX = "stockwatch-"
FILE_SUFFIX = ".sql.gz"


def _pg_dump_bytes() -> bytes:
    """呼叫 pg_dump 取得純 SQL。失敗時把 stderr 一併拋出，方便查原因。"""
    cmd = [
        "pg_dump",
        "-h", os.getenv("POSTGRES_HOST", "postgres"),
        "-p", os.getenv("POSTGRES_PORT", "5432"),
        "-U", os.getenv("POSTGRES_USER", "stockwatch"),
        "-d", os.getenv("POSTGRES_DB", "stockwatch"),
        "--no-owner",        # 還原到不同帳號的資料庫時不會卡權限
        "--no-privileges",
    ]
    env = dict(os.environ)
    env["PGPASSWORD"] = os.getenv("POSTGRES_PASSWORD", "")

    result = subprocess.run(cmd, capture_output=True, env=env, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(
            f"pg_dump 失敗（returncode={result.returncode}）: "
            f"{result.stderr.decode('utf-8', 'replace').strip()}"
        )
    return result.stdout


def _looks_complete(dump: bytes) -> bool:
    """粗略驗證 dump 不是空的或半截的。

    備份最危險的失敗模式是「檔案有產生但內容不完整」——那會讓人以為有備份。
    pg_dump 正常結束時最後一行是 `-- PostgreSQL database dump complete`。
    """
    if len(dump) < 1024:
        return False
    tail = dump[-200:]
    return b"PostgreSQL database dump complete" in tail


def prune_old_backups() -> int:
    """只保留最近 KEEP_COUNT 份，回傳刪除數量。"""
    files = sorted(BACKUP_DIR.glob(f"{FILE_PREFIX}*{FILE_SUFFIX}"), reverse=True)
    removed = 0
    for old in files[KEEP_COUNT:]:
        try:
            old.unlink()
            removed += 1
        except OSError as e:
            logger.error(f"刪除舊備份失敗 {old.name}: {e}")
    return removed


def run_backup() -> Path:
    """執行一次備份，回傳產生的檔案路徑。同步操作，於 asyncio.to_thread 內呼叫。"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    dump = _pg_dump_bytes()
    if not _looks_complete(dump):
        raise RuntimeError(f"pg_dump 輸出看起來不完整（{len(dump)} bytes），不寫入檔案")

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = BACKUP_DIR / f"{FILE_PREFIX}{stamp}{FILE_SUFFIX}"

    # 先寫暫存再改名：中途失敗不會留下看似成功的半截檔案
    tmp = target.with_suffix(".partial")
    with gzip.open(tmp, "wb") as f:
        f.write(dump)
    tmp.rename(target)

    removed = prune_old_backups()
    logger.info(
        f"備份完成 {target.name}（原始 {len(dump)} bytes，"
        f"壓縮後 {target.stat().st_size} bytes，清掉 {removed} 份舊檔）"
    )
    return target


if __name__ == "__main__":
    # 手動執行：python -m app.models.backup
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    path = run_backup()
    print(path)
