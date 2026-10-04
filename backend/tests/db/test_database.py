"""Tests for the app.db SQLite layer."""

import sqlite3
import threading

import pytest

import app.db as db
from app.db import database


@pytest.fixture
def db_path(tmp_path):
    path = tmp_path / "nested" / "dir" / "finally.db"
    db.init_db(str(path))
    return path


class TestInit:
    def test_creates_parent_dir_and_tables(self, db_path):
        assert db_path.exists()
        conn = sqlite3.connect(db_path)
        names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        conn.close()
        assert {
            "users_profile",
            "watchlist",
            "positions",
            "trades",
            "portfolio_snapshots",
            "chat_messages",
        } <= names

    def test_seed_data(self, db_path):
        assert db.get_cash() == 10000.0
        assert db.get_watchlist() == db.DEFAULT_WATCHLIST
        assert db.get_positions() == []
        assert db.get_trades() == []
        assert db.get_snapshots() == []
        assert db.get_chat_messages() == []

    def test_idempotent_and_does_not_reseed(self, db_path):
        db.set_cash(123.0)
        db.remove_watchlist_ticker("AAPL")
        db.init_db(str(db_path))
        db.init_db(str(db_path))
        assert db.get_cash() == 123.0
        assert "AAPL" not in db.get_watchlist()
        assert len(db.get_watchlist()) == 9

    def test_empty_watchlist_not_reseeded(self, db_path):
        for t in db.get_watchlist():
            db.remove_watchlist_ticker(t)
        db.init_db(str(db_path))
        assert db.get_watchlist() == []

    def test_db_path_env_var(self, tmp_path, monkeypatch):
        path = tmp_path / "env" / "x.db"
        monkeypatch.setenv("DB_PATH", str(path))
        db.init_db()
        assert path.exists()
        assert db.get_db_path() == str(path)

    def test_default_path_is_project_db(self, monkeypatch):
        monkeypatch.delenv("DB_PATH", raising=False)
        parts = database._resolve_path(None).replace("\\", "/").split("/")
        assert parts[-2:] == ["db", "finally.db"]
        assert parts[-3] != "backend"

    def test_unique_constraints(self, db_path):
        conn = sqlite3.connect(db_path)
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO watchlist (id, user_id, ticker, added_at) "
                "VALUES ('x', 'default', 'AAPL', 't')"
            )
        conn.execute(
            "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at) "
            "VALUES ('p1', 'default', 'AAPL', 1, 1, 't')"
        )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at) "
                "VALUES ('p2', 'default', 'AAPL', 1, 1, 't')"
            )
        conn.close()


class TestCash:
    def test_set_and_get(self, db_path):
        db.set_cash(5432.1)
        assert db.get_cash() == pytest.approx(5432.1)


class TestWatchlist:
    def test_add_uppercases_and_appends(self, db_path):
        assert db.add_watchlist_ticker("pypl") is True
        assert db.get_watchlist()[-1] == "PYPL"

    def test_add_duplicate_returns_false(self, db_path):
        assert db.add_watchlist_ticker("AAPL") is False
        assert db.add_watchlist_ticker("aapl") is False
        assert db.get_watchlist().count("AAPL") == 1

    def test_remove(self, db_path):
        assert db.remove_watchlist_ticker("tsla") is True
        assert "TSLA" not in db.get_watchlist()
        assert db.remove_watchlist_ticker("TSLA") is False

    def test_order_by_added(self, db_path):
        db.add_watchlist_ticker("ZZZ")
        db.add_watchlist_ticker("AAA")
        assert db.get_watchlist()[-2:] == ["ZZZ", "AAA"]


class TestPositions:
    def test_upsert_insert_and_update(self, db_path):
        db.upsert_position("aapl", 10, 190.0)
        p = db.get_position("AAPL")
        assert p["ticker"] == "AAPL"
        assert p["quantity"] == 10
        assert p["avg_cost"] == 190.0
        assert p["updated_at"]
        db.upsert_position("AAPL", 15.5, 195.0)
        assert db.get_position("aapl")["quantity"] == 15.5
        assert len(db.get_positions()) == 1

    def test_get_missing(self, db_path):
        assert db.get_position("NOPE") is None

    def test_delete(self, db_path):
        db.upsert_position("MSFT", 1, 400)
        db.delete_position("msft")
        assert db.get_position("MSFT") is None
        db.delete_position("MSFT")  # no error when absent

    def test_get_positions_shape(self, db_path):
        db.upsert_position("MSFT", 2, 2)
        db.upsert_position("AAPL", 1, 1)
        positions = db.get_positions()
        assert [p["ticker"] for p in positions] == ["AAPL", "MSFT"]
        assert set(positions[0]) == {"ticker", "quantity", "avg_cost", "updated_at"}


class TestTrades:
    def test_record_trade(self, db_path):
        t = db.record_trade("aapl", "buy", 2.5, 190.0)
        assert t["ticker"] == "AAPL"
        assert t["side"] == "buy"
        assert t["quantity"] == 2.5
        assert t["price"] == 190.0
        assert t["id"] and t["executed_at"]
        assert db.get_trades() == [t]

    def test_invalid_side(self, db_path):
        with pytest.raises(ValueError):
            db.record_trade("AAPL", "short", 1, 1)

    def test_get_trades_newest_first_and_limit(self, db_path):
        for i in range(5):
            db.record_trade("AAPL", "buy", i + 1, 100)
        trades = db.get_trades(limit=3)
        assert [t["quantity"] for t in trades] == [5, 4, 3]


class TestExecuteTradeAtomic:
    def test_buy(self, db_path):
        t = db.execute_trade_atomic("aapl", "buy", 10, 100.0, 9000.0, 10, 100.0)
        assert t["ticker"] == "AAPL" and t["side"] == "buy"
        assert db.get_cash() == 9000.0
        assert db.get_position("AAPL")["quantity"] == 10
        assert db.get_trades() == [t]

    def test_sell_to_zero_deletes_position(self, db_path):
        db.execute_trade_atomic("AAPL", "buy", 10, 100.0, 9000.0, 10, 100.0)
        db.execute_trade_atomic("AAPL", "sell", 10, 110.0, 10100.0, 1e-12, 100.0)
        assert db.get_position("AAPL") is None
        assert db.get_cash() == 10100.0
        assert len(db.get_trades()) == 2

    def test_partial_sell_keeps_position(self, db_path):
        db.execute_trade_atomic("AAPL", "buy", 10, 100.0, 9000.0, 10, 100.0)
        db.execute_trade_atomic("AAPL", "sell", 4, 90.0, 9360.0, 6, 100.0)
        p = db.get_position("AAPL")
        assert p["quantity"] == 6 and p["avg_cost"] == 100.0

    def test_rollback_on_failure(self, db_path):
        db.execute_trade_atomic("AAPL", "buy", 10, 100.0, 9000.0, 10, 100.0)
        with pytest.raises(ValueError):
            db.execute_trade_atomic("AAPL", "bogus", 5, 100.0, 1.0, 15, 100.0)
        assert db.get_cash() == 9000.0
        assert db.get_position("AAPL")["quantity"] == 10
        assert len(db.get_trades()) == 1

    def test_concurrent_trades(self, db_path):
        errors = []

        def worker(i):
            try:
                db.execute_trade_atomic(f"T{i}", "buy", 1, 1.0, 100.0, 1, 1.0)
            except Exception as e:  # pragma: no cover
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
        for th in threads:
            th.start()
        for th in threads:
            th.join()
        assert not errors
        assert len(db.get_positions()) == 10
        assert len(db.get_trades()) == 10


class TestSnapshots:
    def test_record_and_get_ascending(self, db_path):
        for v in (100.0, 200.0, 300.0):
            db.record_snapshot(v)
        snaps = db.get_snapshots()
        assert [s["total_value"] for s in snaps] == [100.0, 200.0, 300.0]
        assert set(snaps[0]) == {"total_value", "recorded_at"}

    def test_limit_returns_latest_ascending(self, db_path):
        for v in range(5):
            db.record_snapshot(float(v))
        assert [s["total_value"] for s in db.get_snapshots(limit=2)] == [3.0, 4.0]


class TestChat:
    def test_add_user_message(self, db_path):
        m = db.add_chat_message("user", "hello")
        assert m["role"] == "user" and m["content"] == "hello" and m["actions"] is None
        assert db.get_chat_messages() == [m]

    def test_actions_roundtrip(self, db_path):
        actions = {
            "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1}],
            "watchlist_changes": [],
        }
        db.add_chat_message("assistant", "done", actions)
        assert db.get_chat_messages()[0]["actions"] == actions

    def test_invalid_role(self, db_path):
        with pytest.raises(ValueError):
            db.add_chat_message("system", "x")

    def test_last_n_oldest_to_newest(self, db_path):
        for i in range(25):
            db.add_chat_message("user" if i % 2 == 0 else "assistant", f"m{i}")
        msgs = db.get_chat_messages(limit=20)
        assert len(msgs) == 20
        assert msgs[0]["content"] == "m5"
        assert msgs[-1]["content"] == "m24"
        assert set(msgs[0]) == {"id", "role", "content", "actions", "created_at"}
