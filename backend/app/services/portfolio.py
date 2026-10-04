"""Portfolio valuation, trade execution and snapshots."""

from __future__ import annotations

import logging
import math

from app import db
from app.market import MarketDataSource, PriceCache

from .errors import ServiceError
from .universe import sync_ticker
from .watchlist import normalize_ticker

logger = logging.getLogger(__name__)

EPSILON = 1e-9


def _round_money(value: float) -> float:
    return round(value, 2)


def _round_pct(value: float) -> float:
    return round(value, 4)


def build_portfolio(cache: PriceCache) -> dict:
    """Current portfolio valued at live cached prices (falls back to avg_cost)."""
    cash = float(db.get_cash())
    rows = []
    positions_value = 0.0
    cost_basis_total = 0.0
    for pos in db.get_positions():
        qty = float(pos["quantity"])
        avg_cost = float(pos["avg_cost"])
        cached = cache.get_price(pos["ticker"])
        price = float(cached) if cached is not None else avg_cost
        market_value = qty * price
        cost_basis = qty * avg_cost
        pnl_pct = (price - avg_cost) / avg_cost * 100 if avg_cost else 0.0
        positions_value += market_value
        cost_basis_total += cost_basis
        rows.append(
            {
                "ticker": pos["ticker"],
                "quantity": qty,
                "avg_cost": round(avg_cost, 4),
                "current_price": price,
                "market_value": market_value,
                "unrealized_pnl": market_value - cost_basis,
                "unrealized_pnl_percent": _round_pct(pnl_pct),
            }
        )

    for row in rows:
        row["weight"] = (
            _round_pct(row["market_value"] / positions_value) if positions_value > 0 else 0.0
        )
        row["market_value"] = _round_money(row["market_value"])
        row["unrealized_pnl"] = _round_money(row["unrealized_pnl"])

    unrealized = positions_value - cost_basis_total
    return {
        "cash": _round_money(cash),
        "total_value": _round_money(cash + positions_value),
        "positions_value": _round_money(positions_value),
        "unrealized_pnl": _round_money(unrealized),
        "unrealized_pnl_percent": (
            _round_pct(unrealized / cost_basis_total * 100) if cost_basis_total > 0 else 0.0
        ),
        "positions": rows,
    }


def record_snapshot(cache: PriceCache) -> float:
    """Persist the current total portfolio value; returns it."""
    total = build_portfolio(cache)["total_value"]
    db.record_snapshot(total)
    return total


def get_history(limit: int = 1000) -> dict:
    return {
        "snapshots": [
            {"total_value": s["total_value"], "recorded_at": s["recorded_at"]}
            for s in db.get_snapshots(limit)
        ]
    }


def _validate_quantity(quantity) -> float:
    if isinstance(quantity, bool):
        raise ServiceError("Quantity must be a number")
    try:
        qty = float(quantity)
    except (TypeError, ValueError):
        raise ServiceError("Quantity must be a number") from None
    if not math.isfinite(qty) or qty <= 0:
        raise ServiceError("Quantity must be greater than zero")
    return qty


async def _resolve_price(
    cache: PriceCache, source: MarketDataSource | None, ticker: str
) -> float:
    price = cache.get_price(ticker)
    if price is None and source is not None:
        # Untracked ticker: start tracking it so the source can seed a price.
        await source.add_ticker(ticker)
        price = cache.get_price(ticker)
        if price is None:
            await sync_ticker(source, ticker)  # drop it again unless watched/held
    if price is None or price <= 0:
        raise ServiceError(f"No price available for {ticker} yet - try again shortly")
    return float(price)


async def execute_trade(
    cache: PriceCache,
    source: MarketDataSource | None,
    ticker,
    side,
    quantity,
) -> dict:
    """Execute a market order at the current cached price.

    Raises ServiceError on invalid input, unknown price, insufficient cash or
    insufficient shares. Returns the persisted trade row.
    """
    ticker = normalize_ticker(ticker)
    side = str(side or "").strip().lower()
    if side not in ("buy", "sell"):
        raise ServiceError("Side must be 'buy' or 'sell'")
    qty = _validate_quantity(quantity)
    price = await _resolve_price(cache, source, ticker)

    # No awaits between here and the DB write: read-validate-write is atomic
    # with respect to other requests running on the event loop.
    cash = float(db.get_cash())
    pos = db.get_position(ticker)
    old_qty = float(pos["quantity"]) if pos else 0.0
    old_avg = float(pos["avg_cost"]) if pos else 0.0
    notional = qty * price

    if side == "buy":
        if notional > cash + EPSILON:
            raise ServiceError(f"Insufficient cash: need ${notional:,.2f}, have ${cash:,.2f}")
        new_cash = cash - notional
        new_qty = old_qty + qty
        new_avg = (old_qty * old_avg + qty * price) / new_qty
    else:
        if old_qty + EPSILON < qty:
            raise ServiceError(
                f"Insufficient shares: trying to sell {qty:g} {ticker}, hold {old_qty:g}"
            )
        new_cash = cash + notional
        new_qty = old_qty - qty
        if abs(new_qty) < 1e-6:
            new_qty = 0.0
        new_avg = old_avg

    trade = db.execute_trade_atomic(
        ticker, side, qty, price, max(new_cash, 0.0), new_qty, new_avg
    )

    try:
        await sync_ticker(source, ticker)
    except Exception:  # never fail a committed trade on a market-source hiccup
        logger.exception("Failed to sync tracked tickers after trade on %s", ticker)
    try:
        record_snapshot(cache)
    except Exception:
        logger.exception("Failed to record post-trade snapshot")
    return trade
