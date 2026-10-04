import pytest

from app import db
from app.services import (
    NotFoundError,
    ServiceError,
    add_to_watchlist,
    execute_trade,
    get_watchlist_view,
    normalize_ticker,
    remove_from_watchlist,
    tracked_tickers,
)


@pytest.mark.parametrize("raw,expected", [("aapl", "AAPL"), (" brk.b ", "BRK.B"), ("V", "V")])
def test_normalize_ticker(raw, expected):
    assert normalize_ticker(raw) == expected


@pytest.mark.parametrize("raw", ["", None, "   ", "AB1", "ABCDEFGHIJK", "A B", "$X"])
def test_normalize_ticker_rejects(raw):
    with pytest.raises(ServiceError):
        normalize_ticker(raw)


def test_view_includes_prices_and_nulls(temp_db, cache):
    cache.update("AAPL", 100.0)
    cache.update("AAPL", 101.0)
    view = get_watchlist_view(cache)["tickers"]
    assert [r["ticker"] for r in view][:3] == ["AAPL", "GOOGL", "MSFT"]
    assert len(view) == 10
    aapl = view[0]
    assert aapl["price"] == 101.0
    assert aapl["previous_price"] == 100.0
    assert aapl["change"] == 1.0
    assert aapl["direction"] == "up"
    googl = view[1]
    assert googl["price"] is None and googl["direction"] is None


async def test_add_ticker_tracks_it(source, cache):
    assert await add_to_watchlist(source, "pypl") == "PYPL"
    assert "PYPL" in db.get_watchlist()
    assert "PYPL" in source.get_tickers()
    assert cache.get_price("PYPL") == 100.0


async def test_add_duplicate_rejected(source):
    with pytest.raises(ServiceError, match="already"):
        await add_to_watchlist(source, "AAPL")


async def test_remove_untracks_when_not_held(source, cache):
    assert await remove_from_watchlist(source, "aapl") == "AAPL"
    assert "AAPL" not in db.get_watchlist()
    assert "AAPL" not in source.get_tickers()
    assert "AAPL" not in cache


async def test_remove_keeps_tracking_when_held(source, cache):
    await execute_trade(cache, source, "AAPL", "buy", 1)
    await remove_from_watchlist(source, "AAPL")
    assert "AAPL" in source.get_tickers()
    assert "AAPL" in tracked_tickers()
    assert cache.get_price("AAPL") is not None


async def test_remove_absent_is_not_found(source):
    with pytest.raises(NotFoundError):
        await remove_from_watchlist(source, "ZZZZ")


def test_tracked_tickers_is_union(temp_db):
    db.upsert_position("PYPL", 1, 10.0)
    db.upsert_position("AAPL", 1, 10.0)
    t = tracked_tickers()
    assert t[:10] == db.get_watchlist()
    assert t[10:] == ["PYPL"]
