import pytest

from app import db
from app.services import (
    ServiceError,
    build_portfolio,
    execute_trade,
    get_history,
    record_snapshot,
    tracked_tickers,
)


class TestBuildPortfolio:
    def test_fresh_portfolio(self, temp_db, cache):
        p = build_portfolio(cache)
        assert p == {
            "cash": 10000.0,
            "total_value": 10000.0,
            "positions_value": 0.0,
            "unrealized_pnl": 0.0,
            "unrealized_pnl_percent": 0.0,
            "positions": [],
        }

    def test_valuation_with_live_prices(self, temp_db, cache):
        db.upsert_position("AAPL", 10, 100.0)
        db.upsert_position("MSFT", 5, 200.0)
        db.set_cash(5000.0)
        cache.update("AAPL", 110.0)
        cache.update("MSFT", 180.0)
        p = build_portfolio(cache)
        assert p["positions_value"] == 2000.0  # 1100 + 900
        assert p["total_value"] == 7000.0
        assert p["unrealized_pnl"] == 0.0  # +100 -100
        rows = {r["ticker"]: r for r in p["positions"]}
        assert rows["AAPL"]["unrealized_pnl"] == 100.0
        assert rows["AAPL"]["unrealized_pnl_percent"] == 10.0
        assert rows["MSFT"]["unrealized_pnl"] == -100.0
        assert rows["MSFT"]["unrealized_pnl_percent"] == -10.0
        assert rows["AAPL"]["weight"] == 0.55
        assert rows["MSFT"]["weight"] == 0.45
        assert set(rows["AAPL"]) == {
            "ticker", "quantity", "avg_cost", "current_price", "market_value",
            "unrealized_pnl", "unrealized_pnl_percent", "weight",
        }

    def test_missing_price_falls_back_to_avg_cost(self, temp_db, cache):
        db.upsert_position("ZZZ", 2, 50.0)
        p = build_portfolio(cache)
        assert p["positions"][0]["current_price"] == 50.0
        assert p["positions"][0]["unrealized_pnl"] == 0.0
        assert p["total_value"] == 10100.0


class TestExecuteTrade:
    async def test_buy_reduces_cash_and_creates_position(self, source, cache):
        trade = await execute_trade(cache, source, "aapl", "buy", 10)
        assert trade["ticker"] == "AAPL"
        assert trade["side"] == "buy"
        assert trade["price"] == 190.0
        assert db.get_cash() == pytest.approx(8100.0)
        pos = db.get_position("AAPL")
        assert pos["quantity"] == 10
        assert pos["avg_cost"] == 190.0

    async def test_weighted_average_cost(self, source, cache):
        await execute_trade(cache, source, "AAPL", "buy", 10)  # @190
        cache.update("AAPL", 210.0)
        await execute_trade(cache, source, "AAPL", "buy", 30)  # @210
        pos = db.get_position("AAPL")
        assert pos["quantity"] == 40
        assert pos["avg_cost"] == pytest.approx((10 * 190 + 30 * 210) / 40)

    async def test_fractional_shares(self, source, cache):
        await execute_trade(cache, source, "AAPL", "buy", 0.5)
        assert db.get_position("AAPL")["quantity"] == 0.5
        assert db.get_cash() == pytest.approx(10000 - 95.0)

    async def test_sell_keeps_avg_cost_and_adds_cash(self, source, cache):
        await execute_trade(cache, source, "AAPL", "buy", 10)
        cache.update("AAPL", 150.0)  # selling at a loss
        await execute_trade(cache, source, "AAPL", "sell", 4)
        pos = db.get_position("AAPL")
        assert pos["quantity"] == 6
        assert pos["avg_cost"] == 190.0
        assert db.get_cash() == pytest.approx(10000 - 1900 + 600)

    async def test_full_sell_removes_position(self, source, cache):
        await execute_trade(cache, source, "AAPL", "buy", 3)
        await execute_trade(cache, source, "AAPL", "sell", 3)
        assert db.get_position("AAPL") is None
        assert db.get_cash() == pytest.approx(10000.0)

    async def test_insufficient_cash(self, source, cache):
        with pytest.raises(ServiceError, match="Insufficient cash"):
            await execute_trade(cache, source, "NFLX", "buy", 100)
        assert db.get_cash() == 10000.0
        assert db.get_trades() == []

    async def test_insufficient_shares(self, source, cache):
        with pytest.raises(ServiceError, match="Insufficient shares"):
            await execute_trade(cache, source, "AAPL", "sell", 1)
        await execute_trade(cache, source, "AAPL", "buy", 2)
        with pytest.raises(ServiceError, match="Insufficient shares"):
            await execute_trade(cache, source, "AAPL", "sell", 2.5)

    @pytest.mark.parametrize("qty", [0, -1, "abc", None, float("nan"), float("inf"), True])
    async def test_invalid_quantity(self, source, cache, qty):
        with pytest.raises(ServiceError):
            await execute_trade(cache, source, "AAPL", "buy", qty)

    @pytest.mark.parametrize("side", ["hold", "", None])
    async def test_invalid_side(self, source, cache, side):
        with pytest.raises(ServiceError):
            await execute_trade(cache, source, "AAPL", side, 1)

    @pytest.mark.parametrize("ticker", ["", "  ", "AAPL1", "TOOLONGTICKER", "A-B"])
    async def test_invalid_ticker(self, source, cache, ticker):
        with pytest.raises(ServiceError):
            await execute_trade(cache, source, ticker, "buy", 1)

    async def test_untracked_ticker_gets_tracked_on_buy(self, source, cache):
        await execute_trade(cache, source, "PYPL", "buy", 1)  # FakeSource seeds 100.0
        assert "PYPL" in source.get_tickers()
        assert "PYPL" in tracked_tickers()
        assert db.get_position("PYPL")["avg_cost"] == 100.0

    async def test_unknown_price_rejected_and_not_left_tracked(self, source, cache):
        source.unpriced.add("NOPE")
        with pytest.raises(ServiceError, match="No price"):
            await execute_trade(cache, source, "NOPE", "buy", 1)
        assert "NOPE" not in source.get_tickers()

    async def test_unknown_price_without_source(self, temp_db, cache):
        with pytest.raises(ServiceError, match="No price"):
            await execute_trade(cache, None, "AAPL", "buy", 1)

    async def test_selling_off_unwatched_ticker_stops_tracking(self, source, cache):
        await execute_trade(cache, source, "PYPL", "buy", 2)
        await execute_trade(cache, source, "PYPL", "sell", 2)
        assert "PYPL" not in source.get_tickers()
        assert "PYPL" not in cache

    async def test_selling_off_watched_ticker_keeps_tracking(self, source, cache):
        await execute_trade(cache, source, "AAPL", "buy", 2)
        await execute_trade(cache, source, "AAPL", "sell", 2)
        assert "AAPL" in source.get_tickers()

    async def test_trade_records_snapshot(self, source, cache):
        await execute_trade(cache, source, "AAPL", "buy", 1)
        snaps = db.get_snapshots()
        assert len(snaps) == 1
        assert snaps[0]["total_value"] == pytest.approx(10000.0)


class TestSnapshots:
    def test_record_and_history(self, temp_db, cache):
        db.upsert_position("AAPL", 1, 100.0)
        cache.update("AAPL", 120.0)
        assert record_snapshot(cache) == 10120.0
        hist = get_history()
        assert hist == {"snapshots": [{"total_value": 10120.0, "recorded_at": hist["snapshots"][0]["recorded_at"]}]}
