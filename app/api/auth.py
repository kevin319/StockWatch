from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from google.oauth2 import id_token
from google.auth.transport import requests
from app.core.config import settings
from app.core.security import create_access_token

router = APIRouter()

@router.get("/")
async def read_root():
    return FileResponse("static/login.html")

@router.get("/home")
async def read_home(request: Request):
    # 檢查是否有 state 和 code 參數（Google OAuth2 重定向）
    state = request.query_params.get("state")
    code = request.query_params.get("code")
    
    if state and code:
        # 處理 OAuth 重定向
        try:
            # 驗證 state（可以添加額外的安全檢查）
            return FileResponse("static/index.html")
        except Exception as e:
            return HTTPException(status_code=401, detail="驗證失敗")
    
    return FileResponse("static/index.html")

@router.get("/verify_token")
async def verify_token(token: str):
    try:
        # 驗證 Google Token
        idinfo = id_token.verify_oauth2_token(
            token, requests.Request(), settings.GOOGLE_CLIENT_ID)

        if idinfo['aud'] != settings.GOOGLE_CLIENT_ID:
            raise ValueError('錯誤的 Client ID')

        # 返回用戶資訊
        return {
            'valid': True,
            'email': idinfo['email'],
            'name': idinfo.get('name', ''),
            'picture': idinfo.get('picture', '')
        }
    except ValueError:
        raise HTTPException(status_code=401, detail="無效的 Token")
