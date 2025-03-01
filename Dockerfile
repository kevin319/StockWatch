# 使用 Python 和 Node.js 的多階段構建
FROM node:18-slim as frontend-builder

# 設定工作目錄
WORKDIR /app

# 複製前端相關文件
COPY package.json yarn.lock ./
COPY static ./static
COPY tailwind.config.js postcss.config.js ./

# 安裝依賴並構建 CSS
RUN yarn install && \
    yarn global add tailwindcss postcss autoprefixer && \
    tailwindcss -i ./static/css/input.css -o ./static/css/output.css --minify

# 第二階段：Python 應用
FROM python:3.11-slim

# 設定工作目錄
WORKDIR /app

# 複製依賴文件
COPY requirements.txt .

# 安裝依賴
RUN pip install --no-cache-dir -r requirements.txt

# 複製專案文件
COPY . .

# 從前一階段複製編譯後的 CSS
COPY --from=frontend-builder /app/static/css/output.css /app/static/css/

# 設定環境變數
ENV PORT=8000

# 暴露端口
EXPOSE 8000

# 啟動命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
