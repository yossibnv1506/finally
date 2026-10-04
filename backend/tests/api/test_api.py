import time

import pytest


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_lifespan_starts_source_with_tracked_universe(client):
    assert client.source.started
    assert client.source.get_tickers()[:3] == ["AAPL", "GOOGL", "MSFT"]
    assert len(client.source.get_tickers()) == 10


def test_startup_snapshot_recorded(client):
    snaps = client.get("/api/portfolio/history").json()["snapshots"]
    assert len(snaps) >= 1
    assert snaps[0]["total_value"] == 10000.0
    assert set(snaps[0]) == {"total_value", "recorded_at"}


def test_periodic_snapshots(make_client):
    c = make_client(snapshot_interval=0.05)
    deadline = time.time() + 5
    while time.time() < deadline:
        if len(c.get("/api/portfolio/history").json()["snapshots"]) >= 3:
            break
        time.sleep(0.05)
    assert len(c.get("/api/portfolio/history").json()["snapshots"]) >= 3


class TestPortfolio:
    def test_initial(self, client):
        r = client.get("/api/portfolio")
        assert r.status_code == 200
        body = r.json()
        assert body["cash"] == 10000.0
        assert body["total_value"] == 10000.0
        assert body["positions"] == []
        assert set(body) == {
            "cash", "total_value", "positions_value", "unrealized_pnl",
            "unrealized_pnl_percent", "positions",
        }

    def test_buy_then_sell(self, client):
        r = client.post("/api/portfolio/trade", json={"ticker": "aapl", "quantity": 10, "side": "buy"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body["trade"]) == {"id", "ticker", "side", "quantity", "price", "executed_at"}
        assert body["trade"]["ticker"] == "AAPL"
        assert body["portfolio"]["cash"] == 8100.0
        pos = body["portfolio"]["positions"][0]
        assert pos["ticker"] == "AAPL" and pos["quantity"] == 10 and pos["weight"] == 1.0

        r = client.post("/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 10, "side": "sell"})
        assert r.status_code == 200
        assert r.json()["portfolio"]["positions"] == []
        assert r.json()["portfolio"]["cash"] == 10000.0
        # startup snapshot + one per trade
        assert len(client.get("/api/portfolio/history").json()["snapshots"]) >= 3

    @pytest.mark.parametrize(
        "payload,fragment",
        [
            ({"ticker": "AAPL", "quantity": 0, "side": "buy"}, "greater than zero"),
            ({"ticker": "AAPL", "quantity": -3, "side": "buy"}, "greater than zero"),
            ({"ticker": "AAPL", "quantity": 1000, "side": "buy"}, "Insufficient cash"),
            ({"ticker": "AAPL", "quantity": 1, "side": "sell"}, "Insufficient shares"),
            ({"ticker": "AAPL", "quantity": 1, "side": "short"}, "Side"),
            ({"ticker": "", "quantity": 1, "side": "buy"}, "Ticker"),
            ({"quantity": 1, "side": "buy"}, "Ticker"),
        ],
    )
    def test_trade_errors_are_400(self, client, payload, fragment):
        r = client.post("/api/portfolio/trade", json=payload)
        assert r.status_code == 400
        assert fragment in r.json()["detail"]

    def test_unknown_price_is_400(self, client):
        client.source.unpriced.add("NOPE")
        r = client.post("/api/portfolio/trade", json={"ticker": "NOPE", "quantity": 1, "side": "buy"})
        assert r.status_code == 400
        assert "No price" in r.json()["detail"]

    def test_malformed_json_is_400(self, client):
        r = client.post(
            "/api/portfolio/trade", content="not json", headers={"content-type": "application/json"}
        )
        assert r.status_code == 400
        assert "detail" in r.json()


class TestWatchlist:
    def test_get(self, client):
        r = client.get("/api/watchlist")
        assert r.status_code == 200
        tickers = r.json()["tickers"]
        assert len(tickers) == 10
        assert tickers[0]["ticker"] == "AAPL"
        assert tickers[0]["price"] == 190.0
        assert set(tickers[0]) == {
            "ticker", "price", "previous_price", "change", "change_percent", "direction",
        }

    def test_add_and_remove(self, client):
        r = client.post("/api/watchlist", json={"ticker": "pypl"})
        assert r.status_code == 201
        assert r.json() == {"ticker": "PYPL"}
        assert "PYPL" in client.source.get_tickers()
        assert any(t["ticker"] == "PYPL" for t in client.get("/api/watchlist").json()["tickers"])

        r = client.delete("/api/watchlist/pypl")
        assert r.status_code == 200
        assert r.json() == {"ticker": "PYPL"}
        assert "PYPL" not in client.source.get_tickers()

    @pytest.mark.parametrize("ticker", ["", "AB1", "TOOLONGTICKER", None])
    def test_add_invalid(self, client, ticker):
        r = client.post("/api/watchlist", json={"ticker": ticker})
        assert r.status_code == 400

    def test_add_duplicate(self, client):
        r = client.post("/api/watchlist", json={"ticker": "AAPL"})
        assert r.status_code == 400
        assert "already" in r.json()["detail"]

    def test_remove_absent_404(self, client):
        r = client.delete("/api/watchlist/ZZZZ")
        assert r.status_code == 404

    def test_remove_held_ticker_keeps_streaming(self, client):
        client.post("/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 1, "side": "buy"})
        assert client.delete("/api/watchlist/AAPL").status_code == 200
        assert "AAPL" in client.source.get_tickers()
        tickers = [t["ticker"] for t in client.get("/api/watchlist").json()["tickers"]]
        assert "AAPL" not in tickers


class TestChat:
    def test_mock_buy(self, client):
        r = client.post("/api/chat", json={"message": "buy 3 AAPL"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"message", "trades", "watchlist_changes"}
        trade = body["trades"][0]
        assert trade == {
            "ticker": "AAPL", "side": "buy", "quantity": 3.0, "price": 190.0,
            "status": "executed", "error": None,
        }
        pos = client.get("/api/portfolio").json()["positions"]
        assert pos[0]["ticker"] == "AAPL" and pos[0]["quantity"] == 3

    def test_mock_failed_trade_reported(self, client):
        body = client.post("/api/chat", json={"message": "sell 3 AAPL"}).json()
        assert body["trades"][0]["status"] == "failed"
        assert "Insufficient shares" in body["trades"][0]["error"]

    def test_mock_watchlist_add(self, client):
        body = client.post("/api/chat", json={"message": "add PYPL"}).json()
        assert body["watchlist_changes"] == [
            {"ticker": "PYPL", "action": "add", "status": "executed", "error": None}
        ]

    def test_plain_message(self, client):
        body = client.post("/api/chat", json={"message": "how am I doing?"}).json()
        assert body["message"]
        assert body["trades"] == [] and body["watchlist_changes"] == []

    def test_empty_message_400(self, client):
        assert client.post("/api/chat", json={"message": ""}).status_code == 400
        assert client.post("/api/chat", json={}).status_code == 400

    def test_history(self, client):
        client.post("/api/chat", json={"message": "buy 1 AAPL"})
        msgs = client.get("/api/chat/history").json()["messages"]
        assert [m["role"] for m in msgs] == ["user", "assistant"]
        assert msgs[0]["content"] == "buy 1 AAPL"
        assert msgs[1]["actions"]["trades"][0]["status"] == "executed"
        assert set(msgs[0]) == {"id", "role", "content", "actions", "created_at"}


def test_sse_route_registered_once_per_app(make_client):
    a = make_client()
    b = make_client()
    for c in (a, b):
        paths = [getattr(r, "path", None) for r in c.app.router.routes]
        assert paths.count("/api/stream/prices") == 1


def test_static_served_after_api(make_client, tmp_path):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<html>FinAlly UI</html>", encoding="utf-8")
    c = make_client(static_dir=static)
    r = c.get("/")
    assert r.status_code == 200 and "FinAlly UI" in r.text
    assert c.get("/api/health").json() == {"status": "ok"}


def test_no_static_dir_root_404(client):
    assert client.get("/").status_code == 404
