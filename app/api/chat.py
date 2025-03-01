from fastapi import APIRouter
import aiohttp
from app.core.config import settings
from app.models.schemas import ChatRequest

router = APIRouter(prefix="/api")

@router.post("/chat")
async def chat(request: ChatRequest):
    try:
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": settings.GEMINI_API_KEY
        }
        
        data = {
            "contents": [{
                "parts": [{
                    "text": request.message
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
