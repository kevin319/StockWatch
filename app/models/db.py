import psycopg2
from psycopg2.extras import RealDictCursor
import logging
import os
from dotenv import load_dotenv

# 載入環境變數
load_dotenv()

logger = logging.getLogger(__name__)

def get_db_connection():
    """獲取資料庫連接，並設定時區為 Asia/Taipei"""
    conn = psycopg2.connect(
        dbname=os.getenv('POSTGRES_DB'),
        user=os.getenv('POSTGRES_USER'),
        password=os.getenv('POSTGRES_PASSWORD'),
        host=os.getenv('POSTGRES_HOST', 'localhost'),
        port=os.getenv('POSTGRES_PORT', '5432')
    )
    
    # 設定時區為 Asia/Taipei
    cursor = conn.cursor()
    cursor.execute("SET timezone = 'Asia/Taipei'")
    conn.commit()
    
    return conn



def upsert_user(email: str, name: str, picture: str) -> dict:
    """
    更新或創建用戶資料
    
    Args:
        email: 用戶郵箱
        name: 用戶名稱
        picture: 頭像 URL
        
    Returns:
        dict: 包含用戶資料的字典
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # 使用 INSERT ON CONFLICT 進行 upsert
        sql = """
            INSERT INTO users (email, name, picture_url, last_login, created_at, updated_at)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (email) 
            DO UPDATE SET
                name = EXCLUDED.name,
                picture_url = EXCLUDED.picture_url,
                last_login = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            RETURNING email, name, picture_url;
        """
        
        cur.execute(sql, (email, name, picture))
        user = cur.fetchone()
        conn.commit()
        
        return dict(user)
    except Exception as e:
        logger.error(f"資料庫操作錯誤: {str(e)}")
        raise Exception("資料庫操作錯誤")
    finally:
        if 'cur' in locals():
            cur.close()
        if 'conn' in locals():
            conn.close()
