"""Request-scoped access to shared app state and error mapping."""

from __future__ import annotations

from fastapi import HTTPException, Request

from app.market import MarketDataSource, PriceCache
from app.services.errors import NotFoundError, ServiceError


def get_cache(request: Request) -> PriceCache:
    return request.app.state.price_cache


def get_source(request: Request) -> MarketDataSource | None:
    return getattr(request.app.state, "market_source", None)


def to_http(exc: ServiceError) -> HTTPException:
    status = 404 if isinstance(exc, NotFoundError) else 400
    return HTTPException(status_code=status, detail=str(exc))
