"""Tracked ticker universe = watchlist ∪ open positions (PLAN.md §6)."""

from __future__ import annotations

from app import db
from app.market import MarketDataSource


def tracked_tickers() -> list[str]:
    """Watchlist order first, then any held tickers not on the watchlist."""
    tickers = list(db.get_watchlist())
    seen = set(tickers)
    for pos in db.get_positions():
        if pos["ticker"] not in seen:
            tickers.append(pos["ticker"])
            seen.add(pos["ticker"])
    return tickers


def is_tracked(ticker: str) -> bool:
    return ticker in db.get_watchlist() or db.get_position(ticker) is not None


async def sync_ticker(source: MarketDataSource | None, ticker: str) -> None:
    """Add/remove `ticker` on the market source to match the tracked universe."""
    if source is None:
        return
    if is_tracked(ticker):
        await source.add_ticker(ticker)
    else:
        await source.remove_ticker(ticker)
