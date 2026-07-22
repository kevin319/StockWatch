from pydantic import BaseModel

class ChatRequest(BaseModel):
    message: str
    ticker: str | None = None
    context: str | None = None
