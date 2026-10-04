"""Deterministic mock responses for LLM_MOCK=true (no network)."""

import re

from .models import ChatResponse, TradeRequest, WatchlistChange

DEFAULT_MOCK_MESSAGE = "FinAlly mock response: I can help you analyze your portfolio."

_TICKER = r"([A-Za-z][A-Za-z.]{0,9})\b"
_QTY = r"(\d+(?:\.\d+)?)"
_TRADE_RE = re.compile(
    rf"\b(buy|sell)\s+{_QTY}\s+(?:shares?\s+(?:of\s+)?)?{_TICKER}", re.IGNORECASE
)
_WATCH_RE = re.compile(rf"\b(add|remove)\s+{_TICKER}", re.IGNORECASE)


def _fmt_qty(qty: float) -> str:
    return str(int(qty)) if qty == int(qty) else f"{qty:g}"


def mock_response(user_message: str) -> ChatResponse:
    """Return a deterministic ChatResponse based on simple keyword rules."""
    m = _TRADE_RE.search(user_message)
    if m:
        side = m.group(1).lower()
        qty = float(m.group(2))
        ticker = m.group(3).upper()
        verb = "Buying" if side == "buy" else "Selling"
        return ChatResponse(
            message=f"{verb} {_fmt_qty(qty)} shares of {ticker}.",
            trades=[TradeRequest(ticker=ticker, side=side, quantity=qty)],
        )
    m = _WATCH_RE.search(user_message)
    if m:
        action = m.group(1).lower()
        ticker = m.group(2).upper()
        msg = (
            f"Adding {ticker} to your watchlist."
            if action == "add"
            else f"Removing {ticker} from your watchlist."
        )
        return ChatResponse(
            message=msg, watchlist_changes=[WatchlistChange(ticker=ticker, action=action)]
        )
    return ChatResponse(message=DEFAULT_MOCK_MESSAGE)
