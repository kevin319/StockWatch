from pydantic_settings import BaseSettings
from dotenv import load_dotenv
import os

# 載入 .env 檔案
load_dotenv()

class Settings(BaseSettings):
    # Google OAuth 設定
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID")
    if not GOOGLE_CLIENT_ID:
        raise ValueError("GOOGLE_CLIENT_ID 未在 .env 檔案中設定")

    # DeepSeek API 配置
    DEEPSEEK_API_KEY: str = os.getenv("DEEPSEEK_API_KEY")
    if not DEEPSEEK_API_KEY:
        raise ValueError("DEEPSEEK_API_KEY 未在 .env 檔案中設定")
    DEEPSEEK_API_URL: str = os.getenv("DEEPSEEK_API_URL", "https://api.deepseek.com/v1/chat/completions")
    DEEPSEEK_MODEL: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

    # Finnhub API 設定（選用，缺少時會 fallback 到 yfinance）
    FINNHUB_API_KEY: str = os.getenv("FINNHUB_API_KEY", "")

    # JWT 設定
    JWT_SECRET: str = os.getenv("JWT_SECRET", "your-secret-key")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

settings = Settings()
