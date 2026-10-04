from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.market import MarketDataSource, PriceCache
from app.services import chat as chat_service  # imports app.llm (litellm) at startup
from app.services.errors import ServiceError

from .deps import get_cache, get_source, to_http

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatBody(BaseModel):
    message: Any = None


@router.post("")
async def post_chat(
    body: ChatBody,
    cache: PriceCache = Depends(get_cache),
    source: MarketDataSource | None = Depends(get_source),
) -> dict:
    try:
        return await chat_service.handle_chat(cache, source, body.message)
    except ServiceError as exc:
        raise to_http(exc) from exc


@router.get("/history")
async def chat_history() -> dict:
    return chat_service.get_chat_history()
