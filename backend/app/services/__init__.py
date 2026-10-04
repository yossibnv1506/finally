"""Business logic for portfolio, trades, watchlist and chat.

Services read prices from the shared PriceCache, persist via `app.db`, and keep
the market data source's tracked ticker universe (watchlist ∪ open positions)
in sync.
"""

from .errors import NotFoundError, ServiceError
from .portfolio import build_portfolio, execute_trade, get_history, record_snapshot
from .universe import sync_ticker, tracked_tickers
from .watchlist import add_to_watchlist, get_watchlist_view, normalize_ticker, remove_from_watchlist

__all__ = [
    "NotFoundError",
    "ServiceError",
    "add_to_watchlist",
    "build_portfolio",
    "execute_trade",
    "get_history",
    "get_watchlist_view",
    "normalize_ticker",
    "record_snapshot",
    "remove_from_watchlist",
    "sync_ticker",
    "tracked_tickers",
]
