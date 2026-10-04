"""Chat orchestration: context -> LLM -> auto-execute actions -> persist."""

from __future__ import annotations

import logging

from app import db, llm
from app.market import MarketDataSource, PriceCache

from .errors import ServiceError
from .portfolio import build_portfolio, execute_trade
from .watchlist import add_to_watchlist, remove_from_watchlist

logger = logging.getLogger(__name__)

HISTORY_LIMIT = 20
FALLBACK_MESSAGE = "Sorry, I couldn't process that — please try again."


def build_context(cache: PriceCache) -> dict:
    """Same dict as GET /api/portfolio plus `watchlist` [{ticker, price}]."""
    context = build_portfolio(cache)
    context["watchlist"] = [
        {"ticker": t, "price": cache.get_price(t)} for t in db.get_watchlist()
    ]
    return context


def load_history(limit: int = HISTORY_LIMIT) -> list[dict]:
    return [
        {"role": m["role"], "content": m["content"]}
        for m in db.get_chat_messages(limit)
    ]


async def _run_trades(cache, source, trades) -> list[dict]:
    results = []
    for req in trades:
        ticker = str(getattr(req, "ticker", "") or "").strip().upper()
        side = str(getattr(req, "side", "") or "").strip().lower()
        quantity = getattr(req, "quantity", None)
        item = {
            "ticker": ticker,
            "side": side,
            "quantity": quantity,
            "price": None,
            "status": "failed",
            "error": None,
        }
        try:
            trade = await execute_trade(cache, source, ticker, side, quantity)
            item.update(
                ticker=trade["ticker"],
                quantity=trade["quantity"],
                price=trade["price"],
                status="executed",
            )
        except ServiceError as exc:
            item["error"] = str(exc)
        except Exception as exc:  # best-effort: one bad trade must not abort the rest
            logger.exception("Unexpected error executing chat trade %s", req)
            item["error"] = f"Trade failed: {exc}"
        results.append(item)
    return results


async def _run_watchlist_changes(source, changes) -> list[dict]:
    results = []
    for change in changes:
        ticker = str(getattr(change, "ticker", "") or "").strip().upper()
        action = str(getattr(change, "action", "") or "").strip().lower()
        item = {"ticker": ticker, "action": action, "status": "failed", "error": None}
        try:
            if action == "add":
                item["ticker"] = await add_to_watchlist(source, ticker)
            elif action == "remove":
                item["ticker"] = await remove_from_watchlist(source, ticker)
            else:
                raise ServiceError(f"Unknown watchlist action: {action}")
            item["status"] = "executed"
        except ServiceError as exc:
            item["error"] = str(exc)
        except Exception as exc:
            logger.exception("Unexpected error applying watchlist change %s", change)
            item["error"] = f"Watchlist change failed: {exc}"
        results.append(item)
    return results


async def handle_chat(
    cache: PriceCache, source: MarketDataSource | None, user_message: str
) -> dict:
    """Process one user chat message end to end. Never raises on LLM failure."""
    message = str(user_message or "").strip()
    if not message:
        raise ServiceError("Message is required")

    context = build_context(cache)
    history = load_history()
    db.add_chat_message("user", message)

    try:
        response = await llm.generate_response(message, context, history)
    except Exception as exc:  # llm.LLMError or anything unexpected -> static apology
        if not isinstance(exc, llm.LLMError):
            logger.exception("Unexpected error from LLM layer")
        else:
            logger.warning("LLM call failed: %s", exc)
        db.add_chat_message("assistant", FALLBACK_MESSAGE)
        return {"message": FALLBACK_MESSAGE, "trades": [], "watchlist_changes": []}

    trades = await _run_trades(cache, source, list(response.trades or []))
    changes = await _run_watchlist_changes(source, list(response.watchlist_changes or []))

    result = {"message": response.message, "trades": trades, "watchlist_changes": changes}
    actions = {"trades": trades, "watchlist_changes": changes} if (trades or changes) else None
    db.add_chat_message("assistant", response.message, actions)
    return result


def get_chat_history(limit: int = 50) -> dict:
    return {
        "messages": [
            {
                "id": m["id"],
                "role": m["role"],
                "content": m["content"],
                "actions": m.get("actions"),
                "created_at": m["created_at"],
            }
            for m in db.get_chat_messages(limit)
        ]
    }
