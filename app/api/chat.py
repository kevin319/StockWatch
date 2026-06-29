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
            "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}"
        }

        data = {
            "model": settings.DEEPSEEK_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": request.message}
            ],
            "temperature": 0.7,
            "max_tokens": 256
        }

        url = settings.DEEPSEEK_API_URL.rstrip("/")
        if not url.endswith("/chat/completions"):
            url += "/chat/completions"

        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=data) as response:
                result = await response.json(content_type=None)

                if "choices" in result and len(result["choices"]) > 0:
                    return {"response": result["choices"][0]["message"]["content"]}

                return {"response": "抱歉，我無法處理這個請求。"}
    except Exception as e:
        return {"response": f"發生錯誤: {str(e)}"}
