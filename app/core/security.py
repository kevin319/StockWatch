from datetime import datetime, timedelta
from jose import jwt, JWTError
from fastapi import HTTPException
from app.core.config import settings

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = None):
    if not token:
        raise HTTPException(
            status_code=401,
            detail="未提供認證憑證"
        )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(
                status_code=401,
                detail="無效的認證憑證"
            )
        return email
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="認證憑證已過期"
        )
    except JWTError:
        raise HTTPException(
            status_code=401,
            detail="無法驗證認證憑證"
        )
