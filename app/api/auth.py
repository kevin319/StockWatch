from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from google.oauth2 import id_token
from google.auth.transport import requests
from jose import jwt, JWTError
from datetime import datetime, timedelta, timezone
import asyncio
import logging
import os
from dotenv import load_dotenv
from app.models.db import upsert_user
from app.core.config import settings

# 載入環境變數
load_dotenv()

router = APIRouter()
logger = logging.getLogger(__name__)

# app session token 有效天數（長效，登入一次可維持很久；存於前端 localStorage）
SESSION_DAYS = 30


def _create_access_token(email: str, name: str, picture: str) -> str:
    """簽發本站長效 JWT 作為登入憑證，取代直接使用 1 小時就過期的 Google id_token。"""
    expire = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    claims = {"sub": email, "name": name or "", "picture": picture or "", "exp": expire}
    return jwt.encode(claims, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

@router.get("/")
async def read_root():
    return FileResponse("static/login.html")

@router.get("/home")
async def read_home(request: Request):
    return FileResponse("static/index.html")

@router.get("/verify_token")
async def verify_token(token: str):
    try:
        client_id = os.getenv('GOOGLE_CLIENT_ID')
        if not client_id:
            raise HTTPException(status_code=500, detail="未設定 Google Client ID")

        # 驗證 Google Token（會對 Google 發網路請求，丟到執行緒避免阻塞 event loop）
        idinfo = await asyncio.to_thread(
            id_token.verify_oauth2_token, token, requests.Request(), client_id)

        if idinfo['aud'] != client_id:
            raise ValueError('錯誤的 Client ID')

        # 更新或創建用戶資料
        try:
            user = await asyncio.to_thread(
                upsert_user,
                email=idinfo['email'],
                name=idinfo.get('name', ''),
                picture=idinfo.get('picture', '')
            )
        except Exception as e:
            logger.error(f"資料庫操作錯誤: {str(e)}")
            raise HTTPException(status_code=500, detail="資料庫操作錯誤")

        # 簽發本站長效 JWT，前端存 localStorage 作為後續登入憑證
        access_token = _create_access_token(user['email'], user['name'], user['picture_url'])

        return {
            'valid': True,
            'email': user['email'],
            'name': user['name'],
            'picture': user['picture_url'],
            'access_token': access_token
        }
    except ValueError as e:
        logger.error(f"Token 驗證失敗: {str(e)}")
        raise HTTPException(status_code=401, detail="無效的 Token")
    except Exception as e:
        logger.error(f"驗證過程發生錯誤: {str(e)}")
        raise HTTPException(status_code=500, detail="驗證過程發生錯誤")


@router.get("/verify_session")
async def verify_session(token: str):
    """驗證本站 app JWT（不需再對 Google 發請求）。供 /home 載入時檢查登入態。"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return {
            'valid': True,
            'email': payload.get('sub'),
            'name': payload.get('name', ''),
            'picture': payload.get('picture', '')
        }
    except JWTError:
        return {'valid': False}
