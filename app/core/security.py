from datetime import datetime, timedelta
from jose import jwt, JWTError
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from app.core.config import settings

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


# auto_error=False：缺少 header 時交由下方統一回 401，訊息才一致
_bearer = HTTPBearer(auto_error=False)


async def current_user_email(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """從 Authorization: Bearer <token> 取出並驗證登入者 email。

    這是所有需要登入的端點的唯一身分來源——email 一律由驗證過的 token 推導，
    絕不接受呼叫端自行帶入，否則任何持有效 token 的人都能填別人的 email 讀寫資料。
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="請先登入")

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        # 過期與簽章錯誤都歸在這裡：對前端而言處理方式相同（回登入頁）
        raise HTTPException(status_code=401, detail="登入憑證無效或已過期")

    email = payload.get("sub")
    if not email:
        raise HTTPException(status_code=401, detail="登入憑證無效")
    return email
