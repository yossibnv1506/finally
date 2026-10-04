from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.market import MarketDataSource, PriceCache
from app.services import add_to_watchlist, get_watchlist_view, remove_from_watchlist
from app.services.errors import ServiceError

from .deps import get_cache, get_source, to_http

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


class WatchlistBody(BaseModel):
    ticker: Any = None


@router.get("")
async def get_watchlist(cache: PriceCache = Depends(get_cache)) -> dict:
    return get_watchlist_view(cache)


@router.post("", status_code=201)
async def post_watchlist(
    body: WatchlistBody, source: MarketDataSource | None = Depends(get_source)
) -> dict:
    try:
        ticker = await add_to_watchlist(source, body.ticker)
    except ServiceError as exc:
        raise to_http(exc) from exc
    return {"ticker": ticker}


@router.delete("/{ticker}")
async def delete_watchlist(
    ticker: str, source: MarketDataSource | None = Depends(get_source)
) -> dict:
    try:
        removed = await remove_from_watchlist(source, ticker)
    except ServiceError as exc:
        raise to_http(exc) from exc
    return {"ticker": removed}
