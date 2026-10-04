from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.market import MarketDataSource, PriceCache
from app.services import build_portfolio, execute_trade, get_history
from app.services.errors import ServiceError

from .deps import get_cache, get_source, to_http

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


class TradeBody(BaseModel):
    ticker: Any = None
    quantity: Any = None
    side: Any = None


@router.get("")
async def get_portfolio(cache: PriceCache = Depends(get_cache)) -> dict:
    return build_portfolio(cache)


@router.post("/trade")
async def post_trade(
    body: TradeBody,
    cache: PriceCache = Depends(get_cache),
    source: MarketDataSource | None = Depends(get_source),
) -> dict:
    try:
        trade = await execute_trade(cache, source, body.ticker, body.side, body.quantity)
    except ServiceError as exc:
        raise to_http(exc) from exc
    return {"trade": trade, "portfolio": build_portfolio(cache)}


@router.get("/history")
async def portfolio_history() -> dict:
    return get_history()
