from fastapi import APIRouter
import aiohttp
from app.core.config import settings
from app.models.schemas import ChatRequest

router = APIRouter(prefix="/api")

SYSTEM_PROMPT = """你是一位研究價值投資多年的市場分析專家、就跟巴菲特一樣。請遵循以下原則：

1. 提供專業且客觀的分析意見，問題跟股票、公司無關，就委婉拒絕
2. 使用最近30天內新聞來評估回覆內容，但回覆不需要強調
3. 結合今天股價變化情況說明
4. 使用繁體中文回答
5. 回答要簡潔有力，在70個中文以內

"""

@router.post("/chat")
async def chat(request: ChatRequest):
    try:
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": settings.GEMINI_API_KEY
        }
        
        # 組合系統提示和用戶訊息
        combined_message = f"{SYSTEM_PROMPT}\n\n使用者問題：{request.message}"
        
        data = {
            "contents": [{
                "parts": [{
                    "text": combined_message
                }]
            }]
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(settings.GEMINI_API_URL, headers=headers, json=data) as response:
                result = await response.json()
                
                if 'candidates' in result and len(result['candidates']) > 0:
                    content = result['candidates'][0]['content']
                    if 'parts' in content and len(content['parts']) > 0:
                        return {"response": content['parts'][0]['text']}
                
                return {"response": "抱歉，我無法處理這個請求。"}
    except Exception as e:
        return {"response": f"發生錯誤: {str(e)}"}
