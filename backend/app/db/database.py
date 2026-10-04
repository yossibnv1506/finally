"""SQLite persistence layer for FinAlly.

Plain synchronous ``sqlite3`` with one short-lived connection per call.
All rows belong to ``user_id="default"`` (single-user build, see PLAN.md section 7).
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_USER = "default"
DEFAULT_CASH = 10000.0
DEFAULT_WATCHLIST = ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX"]
QTY_EPSILON = 1e-9

_SCHEMA_PATH = Path(__file__).with_name("schema.sql")
_PROJECT_ROOT = Path(__file__).resolve().parents[3]

_db_path: str | None = None
_init_lock = threading.Lock()
_initialized_paths: set[str] = set()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _resolve_path(db_path: str | None) -> str:
    if db_path:
        return str(db_path)
    env_path = os.environ.get("DB_PATH")
    if env_path:
        return env_path
    return str(_PROJECT_ROOT / "db" / "finally.db")


def get_db_path() -> str:
    """Return the database path currently in use."""
    return _db_path or _resolve_path(None)


def _connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: str | None = None) -> None:
    """Create the parent directory, tables, and seed data (only when empty).

    Idempotent: safe to call any number of times. The chosen path becomes the
    module's active database for all subsequent calls.
    """
    global _db_path
    path = _resolve_path(db_path)
    with _init_lock:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        conn = _connect(path)
        try:
            conn.executescript(_SCHEMA_PATH.read_text(encoding="utf-8"))
            with conn:
                has_user = conn.execute(
                    "SELECT 1 FROM users_profile WHERE id = ?", (DEFAULT_USER,)
                ).fetchone()
                if not has_user:
                    # Fresh database: seed the profile and the default watchlist.
                    now = _now()
                    conn.execute(
                        "INSERT INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?)",
                        (DEFAULT_USER, DEFAULT_CASH, now),
                    )
                    conn.executemany(
                        "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) "
                        "VALUES (?, ?, ?, ?)",
                        [(_new_id(), DEFAULT_USER, t, now) for t in DEFAULT_WATCHLIST],
                    )
        finally:
            conn.close()
        _db_path = path
        _initialized_paths.add(path)


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    """Yield a connection inside a transaction (commit on success, rollback on error)."""
    path = get_db_path()
    if path not in _initialized_paths:
        init_db(path)
    conn = _connect(path)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------- cash


def get_cash() -> float:
    with _conn() as conn:
        row = conn.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER,)
        ).fetchone()
    return float(row["cash_balance"]) if row else 0.0


def _set_cash(conn: sqlite3.Connection, amount: float) -> None:
    conn.execute(
        "UPDATE users_profile SET cash_balance = ? WHERE id = ?", (float(amount), DEFAULT_USER)
    )


def set_cash(amount: float) -> None:
    with _conn() as conn:
        _set_cash(conn, amount)


# ---------------------------------------------------------------- watchlist


def get_watchlist() -> list[str]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY added_at, rowid",
            (DEFAULT_USER,),
        ).fetchall()
    return [r["ticker"] for r in rows]


def add_watchlist_ticker(ticker: str) -> bool:
    """Add a ticker. Returns False if it is already on the watchlist."""
    with _conn() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
            (_new_id(), DEFAULT_USER, ticker.strip().upper(), _now()),
        )
        return cur.rowcount > 0


def remove_watchlist_ticker(ticker: str) -> bool:
    """Remove a ticker. Returns False if it was not on the watchlist."""
    with _conn() as conn:
        cur = conn.execute(
            "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER, ticker.strip().upper()),
        )
        return cur.rowcount > 0


# ---------------------------------------------------------------- positions


def _position_dict(row: sqlite3.Row) -> dict:
    return {
        "ticker": row["ticker"],
        "quantity": float(row["quantity"]),
        "avg_cost": float(row["avg_cost"]),
        "updated_at": row["updated_at"],
    }


def get_positions() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT ticker, quantity, avg_cost, updated_at FROM positions "
            "WHERE user_id = ? ORDER BY ticker",
            (DEFAULT_USER,),
        ).fetchall()
    return [_position_dict(r) for r in rows]


def get_position(ticker: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT ticker, quantity, avg_cost, updated_at FROM positions "
            "WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER, ticker.strip().upper()),
        ).fetchone()
    return _position_dict(row) if row else None


def _upsert_position(conn: sqlite3.Connection, ticker: str, quantity: float, avg_cost: float) -> None:
    conn.execute(
        "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (user_id, ticker) DO UPDATE SET "
        "quantity = excluded.quantity, avg_cost = excluded.avg_cost, updated_at = excluded.updated_at",
        (_new_id(), DEFAULT_USER, ticker, float(quantity), float(avg_cost), _now()),
    )


def _delete_position(conn: sqlite3.Connection, ticker: str) -> None:
    conn.execute("DELETE FROM positions WHERE user_id = ? AND ticker = ?", (DEFAULT_USER, ticker))


def upsert_position(ticker: str, quantity: float, avg_cost: float) -> None:
    with _conn() as conn:
        _upsert_position(conn, ticker.strip().upper(), quantity, avg_cost)


def delete_position(ticker: str) -> None:
    with _conn() as conn:
        _delete_position(conn, ticker.strip().upper())


# ---------------------------------------------------------------- trades


def _trade_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "ticker": row["ticker"],
        "side": row["side"],
        "quantity": float(row["quantity"]),
        "price": float(row["price"]),
        "executed_at": row["executed_at"],
    }


def _insert_trade(
    conn: sqlite3.Connection, ticker: str, side: str, quantity: float, price: float
) -> dict:
    side = side.strip().lower()
    if side not in ("buy", "sell"):
        raise ValueError(f"Invalid side: {side!r}")
    trade = {
        "id": _new_id(),
        "ticker": ticker,
        "side": side,
        "quantity": float(quantity),
        "price": float(price),
        "executed_at": _now(),
    }
    conn.execute(
        "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            trade["id"],
            DEFAULT_USER,
            trade["ticker"],
            trade["side"],
            trade["quantity"],
            trade["price"],
            trade["executed_at"],
        ),
    )
    return trade


def record_trade(ticker: str, side: str, quantity: float, price: float) -> dict:
    with _conn() as conn:
        return _insert_trade(conn, ticker.strip().upper(), side, quantity, price)


def get_trades(limit: int = 100) -> list[dict]:
    """Most recent trades first."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, ticker, side, quantity, price, executed_at FROM trades "
            "WHERE user_id = ? ORDER BY executed_at DESC, rowid DESC LIMIT ?",
            (DEFAULT_USER, int(limit)),
        ).fetchall()
    return [_trade_dict(r) for r in rows]


def execute_trade_atomic(
    ticker: str,
    side: str,
    quantity: float,
    price: float,
    new_cash: float,
    new_qty: float,
    new_avg_cost: float,
) -> dict:
    """Apply a validated trade in one transaction.

    Updates cash, upserts the position (or deletes it when ``new_qty`` is ~0),
    and inserts the trade row. Returns the trade dict. Any failure rolls back
    every change.
    """
    ticker = ticker.strip().upper()
    with _conn() as conn:
        _set_cash(conn, new_cash)
        if abs(new_qty) < QTY_EPSILON:
            _delete_position(conn, ticker)
        else:
            _upsert_position(conn, ticker, new_qty, new_avg_cost)
        return _insert_trade(conn, ticker, side, quantity, price)


# ---------------------------------------------------------------- snapshots


def record_snapshot(total_value: float) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
            "VALUES (?, ?, ?, ?)",
            (_new_id(), DEFAULT_USER, float(total_value), _now()),
        )


def get_snapshots(limit: int = 1000) -> list[dict]:
    """The most recent ``limit`` snapshots, ascending by time."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT total_value, recorded_at FROM ("
            "  SELECT total_value, recorded_at, rowid AS rid FROM portfolio_snapshots "
            "  WHERE user_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT ?"
            ") ORDER BY recorded_at ASC, rid ASC",
            (DEFAULT_USER, int(limit)),
        ).fetchall()
    return [{"total_value": float(r["total_value"]), "recorded_at": r["recorded_at"]} for r in rows]


# ---------------------------------------------------------------- chat


def _chat_dict(row: sqlite3.Row) -> dict:
    actions = row["actions"]
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "actions": json.loads(actions) if actions is not None else None,
        "created_at": row["created_at"],
    }


def add_chat_message(role: str, content: str, actions: dict | None = None) -> dict:
    if role not in ("user", "assistant"):
        raise ValueError(f"Invalid role: {role!r}")
    msg = {
        "id": _new_id(),
        "role": role,
        "content": content,
        "actions": actions,
        "created_at": _now(),
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                msg["id"],
                DEFAULT_USER,
                role,
                content,
                json.dumps(actions) if actions is not None else None,
                msg["created_at"],
            ),
        )
    return msg


def get_chat_messages(limit: int = 20) -> list[dict]:
    """The last ``limit`` messages, ordered oldest to newest."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, role, content, actions, created_at FROM ("
            "  SELECT id, role, content, actions, created_at, rowid AS rid FROM chat_messages "
            "  WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?"
            ") ORDER BY created_at ASC, rid ASC",
            (DEFAULT_USER, int(limit)),
        ).fetchall()
    return [_chat_dict(r) for r in rows]
