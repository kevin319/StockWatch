# 使用 Python 基礎映像
# 釘 bookworm（Debian 12）而非浮動的 -slim：它的 postgresql-client 是 15，與 postgres:15
# server 主版本一致。用較新的 client（trixie 的 17）產出的 dump 會帶 PG15 不認得的指令，
# 還原時若加了 ON_ERROR_STOP=1 會直接中止。順帶讓建置可重現。
FROM python:3.11-slim-bookworm

# 設定工作目錄
WORKDIR /app

# pg_dump：供排程備份使用（見 app/models/backup.py）
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# 複製依賴文件
COPY requirements.txt .

# 安裝依賴
RUN pip install --no-cache-dir -r requirements.txt

# 複製專案文件
COPY . .

# 設定環境變數
ENV PORT=8000

# 暴露端口
EXPOSE 8000

# 啟動命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
