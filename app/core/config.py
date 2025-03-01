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

    # Gemini API 配置
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY")
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY 未在 .env 檔案中設定")
    GEMINI_API_URL: str = os.getenv("GEMINI_API_URL", "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent")

    # JWT 設定
    JWT_SECRET: str = os.getenv("JWT_SECRET", "your-secret-key")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

settings = Settings()
