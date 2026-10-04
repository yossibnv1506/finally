"""Watchlist management."""

from __future__ import annotations

import re

from app import db
from app.market import MarketDataSource, PriceCache

from .errors import NotFoundError, ServiceError
from .universe import sync_ticker

TICKER_RE = re.compile(r"^[A-Z.]{1,10}$")


def normalize_ticker(ticker) -> str:
    """Uppercase/strip and validate a ticker symbol; raises ServiceError."""
    value = str(ticker or "").strip().upper()
    if not value:
        raise ServiceError("Ticker is required")
    if not TICKER_RE.match(value):
        raise ServiceError(f"Invalid ticker symbol: {value}")
    return value


def _empty_row(ticker: str) -> dict:
    return {
        "ticker": ticker,
        "price": None,
        "previous_price": None,
        "change": None,
        "change_percent": None,
        "direction": None,
    }


def get_watchlist_view(cache: PriceCache) -> dict:
    tickers = []
    for ticker in db.get_watchlist():
        update = cache.get(ticker)
        if update is None:
            tickers.append(_empty_row(ticker))
        else:
            tickers.append(
                {
                    "ticker": ticker,
                    "price": update.price,
                    "previous_price": update.previous_price,
                    "change": update.change,
                    "change_percent": update.change_percent,
                    "direction": update.direction,
                }
            )
    return {"tickers": tickers}


async def add_to_watchlist(source: MarketDataSource | None, ticker) -> str:
    ticker = normalize_ticker(ticker)
    if not db.add_watchlist_ticker(ticker):
        raise ServiceError(f"{ticker} is already on the watchlist")
    await sync_ticker(source, ticker)
    return ticker


async def remove_from_watchlist(source: MarketDataSource | None, ticker) -> str:
    value = str(ticker or "").strip().upper()
    if not value or not db.remove_watchlist_ticker(value):
        raise NotFoundError(f"{value or ticker} is not on the watchlist")
    # Keeps streaming if the ticker is still held (tracked-universe semantics).
    await sync_ticker(source, value)
    return value
