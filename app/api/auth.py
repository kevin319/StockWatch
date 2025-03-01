from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from google.oauth2 import id_token
from google.auth.transport import requests
import logging
import os
from dotenv import load_dotenv
from app.models.db import upsert_user

# 載入環境變數
load_dotenv()

router = APIRouter()
logger = logging.getLogger(__name__)

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

        # 驗證 Google Token
        idinfo = id_token.verify_oauth2_token(
            token, requests.Request(), client_id)

        if idinfo['aud'] != client_id:
            raise ValueError('錯誤的 Client ID')

        # 更新或創建用戶資料
        try:
            user = upsert_user(
                email=idinfo['email'],
                name=idinfo.get('name', ''),
                picture=idinfo.get('picture', '')
            )
        except Exception as e:
            logger.error(f"資料庫操作錯誤: {str(e)}")
            raise HTTPException(status_code=500, detail="資料庫操作錯誤")

        return {
            'valid': True,
            'email': user['email'],
            'name': user['name'],
            'picture': user['picture_url']
        }
    except ValueError as e:
        logger.error(f"Token 驗證失敗: {str(e)}")
        raise HTTPException(status_code=401, detail="無效的 Token")
    except Exception as e:
        logger.error(f"驗證過程發生錯誤: {str(e)}")
        raise HTTPException(status_code=500, detail="驗證過程發生錯誤")
