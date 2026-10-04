import pytest

from app import db, llm
from app.llm import ChatResponse, TradeRequest, WatchlistChange
from app.services import chat


@pytest.fixture
def fake_llm(monkeypatch):
    """Patch app.llm.generate_response; returns a dict capturing call args."""
    calls = {}

    def install(response=None, error=None):
        async def fake(user_message, portfolio_context, history):
            calls["user_message"] = user_message
            calls["context"] = portfolio_context
            calls["history"] = history
            if error is not None:
                raise error
            return response

        monkeypatch.setattr(llm, "generate_response", fake)
        return calls

    return install


async def test_context_and_history_passed_to_llm(source, cache, fake_llm):
    for i in range(25):
        db.add_chat_message("user" if i % 2 == 0 else "assistant", f"m{i}")
    calls = fake_llm(ChatResponse(message="hi"))
    result = await chat.handle_chat(cache, source, "hello")
    assert result == {"message": "hi", "trades": [], "watchlist_changes": []}
    assert calls["user_message"] == "hello"
    assert len(calls["history"]) == 20
    assert calls["history"][-1] == {"role": "user", "content": "m24"}
    ctx = calls["context"]
    assert ctx["cash"] == 10000.0
    assert "positions" in ctx and "total_value" in ctx
    assert {"ticker": "AAPL", "price": 190.0} in ctx["watchlist"]


async def test_trades_and_watchlist_executed_best_effort(source, cache, fake_llm):
    fake_llm(
        ChatResponse(
            message="Done",
            trades=[
                TradeRequest(ticker="AAPL", side="buy", quantity=10),
                TradeRequest(ticker="NFLX", side="buy", quantity=1000),  # too expensive
                TradeRequest(ticker="MSFT", side="sell", quantity=1),  # not held
                TradeRequest(ticker="AAPL", side="sell", quantity=5),
            ],
            watchlist_changes=[
                WatchlistChange(ticker="PYPL", action="add"),
                WatchlistChange(ticker="AAPL", action="add"),  # duplicate
                WatchlistChange(ticker="TSLA", action="remove"),
            ],
        )
    )
    result = await chat.handle_chat(cache, source, "do stuff")
    statuses = [(t["ticker"], t["side"], t["status"]) for t in result["trades"]]
    assert statuses == [
        ("AAPL", "buy", "executed"),
        ("NFLX", "buy", "failed"),
        ("MSFT", "sell", "failed"),
        ("AAPL", "sell", "executed"),
    ]
    assert result["trades"][0]["price"] == 190.0 and result["trades"][0]["error"] is None
    assert "Insufficient cash" in result["trades"][1]["error"]
    assert "Insufficient shares" in result["trades"][2]["error"]
    assert db.get_position("AAPL")["quantity"] == 5

    wl = [(w["ticker"], w["action"], w["status"]) for w in result["watchlist_changes"]]
    assert wl == [("PYPL", "add", "executed"), ("AAPL", "add", "failed"), ("TSLA", "remove", "executed")]
    assert "PYPL" in db.get_watchlist() and "TSLA" not in db.get_watchlist()

    msgs = db.get_chat_messages()
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[0]["content"] == "do stuff" and msgs[0]["actions"] is None
    assert msgs[1]["actions"]["trades"] == result["trades"]
    assert msgs[1]["actions"]["watchlist_changes"] == result["watchlist_changes"]


async def test_llm_error_returns_fallback_and_stores_user_message(source, cache, fake_llm):
    fake_llm(error=llm.LLMError("boom"))
    result = await chat.handle_chat(cache, source, "buy 1 AAPL")
    assert result == {"message": chat.FALLBACK_MESSAGE, "trades": [], "watchlist_changes": []}
    assert db.get_trades() == []
    msgs = db.get_chat_messages()
    assert msgs[0]["role"] == "user" and msgs[0]["content"] == "buy 1 AAPL"
    assert all(m["actions"] is None for m in msgs)


async def test_unexpected_exception_also_falls_back(source, cache, fake_llm):
    fake_llm(error=RuntimeError("weird"))
    result = await chat.handle_chat(cache, source, "hi")
    assert result["message"] == chat.FALLBACK_MESSAGE


async def test_empty_message_rejected(source, cache):
    with pytest.raises(chat.ServiceError):
        await chat.handle_chat(cache, source, "   ")


async def test_mock_mode_end_to_end(source, cache, monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")
    result = await chat.handle_chat(cache, source, "buy 2 AAPL")
    assert result["trades"][0]["status"] == "executed"
    assert db.get_position("AAPL")["quantity"] == 2
    result = await chat.handle_chat(cache, source, "add PYPL")
    assert result["watchlist_changes"][0]["status"] == "executed"


def test_chat_history_shape(temp_db):
    db.add_chat_message("user", "q")
    db.add_chat_message("assistant", "a", {"trades": [], "watchlist_changes": []})
    msgs = chat.get_chat_history()["messages"]
    assert [m["content"] for m in msgs] == ["q", "a"]
    assert set(msgs[0]) == {"id", "role", "content", "actions", "created_at"}
