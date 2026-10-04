"""Unit tests for app.llm (no network: litellm is mocked)."""

import json
from types import SimpleNamespace

import pytest

from app.llm import (
    DEFAULT_MOCK_MESSAGE,
    MODEL,
    SYSTEM_PROMPT,
    ChatResponse,
    LLMError,
    build_messages,
    generate_response,
    mock_response,
    parse_response,
)
from app.llm import client as llm_client

CONTEXT = {
    "cash": 8100.0,
    "total_value": 10050.0,
    "positions": [
        {"ticker": "AAPL", "quantity": 10, "avg_cost": 190.0, "current_price": 195.0}
    ],
    "watchlist": [{"ticker": "AAPL", "price": 195.0}, {"ticker": "TSLA", "price": 250.5}],
}


def _fake_response(content):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


@pytest.fixture
def live_mode(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "false")


@pytest.fixture
def mock_mode(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")


@pytest.fixture
def no_network(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("network call attempted")

    monkeypatch.setattr(llm_client.litellm, "completion", boom)


# ---------- parsing ----------


class TestParseResponse:
    def test_full_valid(self):
        raw = json.dumps(
            {
                "message": "Done.",
                "trades": [{"ticker": "aapl", "side": "buy", "quantity": 2.5}],
                "watchlist_changes": [{"ticker": "PYPL", "action": "add"}],
            }
        )
        r = parse_response(raw)
        assert r.message == "Done."
        assert r.trades[0].ticker == "AAPL"
        assert r.trades[0].quantity == 2.5
        assert r.watchlist_changes[0].action == "add"

    def test_message_only(self):
        r = parse_response('{"message": "hi"}')
        assert r.trades == [] and r.watchlist_changes == []

    def test_code_fenced(self):
        r = parse_response('```json\n{"message": "hi", "trades": []}\n```')
        assert r.message == "hi"

    @pytest.mark.parametrize(
        "raw",
        [
            None,
            "",
            "   ",
            "not json",
            '{"message": "x"',
            '{"trades": []}',
            '{"message": "x", "trades": [{"ticker": "AAPL", "side": "hold", "quantity": 1}]}',
            '{"message": "x", "trades": [{"ticker": "AAPL", "side": "buy"}]}',
            '{"message": "x", "watchlist_changes": [{"ticker": "A", "action": "toggle"}]}',
        ],
    )
    def test_malformed_raises(self, raw):
        with pytest.raises(LLMError):
            parse_response(raw)


# ---------- prompt construction ----------


class TestBuildMessages:
    def test_structure_and_context(self):
        history = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi there"},
        ]
        msgs = build_messages("buy $500 of TSLA", CONTEXT, history)
        assert msgs[0] == {"role": "system", "content": SYSTEM_PROMPT}
        assert msgs[1]["role"] == "system"
        assert "8100.0" in msgs[1]["content"]
        assert "TSLA" in msgs[1]["content"] and "250.5" in msgs[1]["content"]
        assert msgs[2:4] == history
        assert msgs[-1] == {"role": "user", "content": "buy $500 of TSLA"}

    def test_history_filters_bad_entries(self):
        history = [{"role": "system", "content": "x"}, {"role": "user", "content": ""}]
        msgs = build_messages("q", {}, history)
        assert len(msgs) == 3

    def test_system_prompt_guidance(self):
        assert "FinAlly" in SYSTEM_PROMPT
        assert "dollar" in SYSTEM_PROMPT.lower()
        assert "JSON" in SYSTEM_PROMPT
        assert "concise" in SYSTEM_PROMPT.lower()


# ---------- live path with mocked litellm ----------


class TestGenerateResponseLive:
    async def test_success_and_call_args(self, live_mode, monkeypatch):
        captured = {}

        def fake_completion(**kwargs):
            captured.update(kwargs)
            return _fake_response(
                '{"message": "Bought.", "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1}],'
                ' "watchlist_changes": []}'
            )

        monkeypatch.setattr(llm_client.litellm, "completion", fake_completion)
        r = await generate_response("buy 1 aapl", CONTEXT, [{"role": "user", "content": "hey"}])
        assert isinstance(r, ChatResponse)
        assert r.trades[0].ticker == "AAPL"
        assert captured["model"] == MODEL
        assert captured["extra_body"] == {"provider": {"order": ["cerebras"]}}
        assert captured["response_format"] is not None
        contents = " ".join(m["content"] for m in captured["messages"])
        assert "8100.0" in contents and "hey" in contents
        assert captured["messages"][-1]["content"] == "buy 1 aapl"

    async def test_network_error_raises_llmerror(self, live_mode, monkeypatch):
        def fail(**kwargs):
            raise ConnectionError("down")

        monkeypatch.setattr(llm_client.litellm, "completion", fail)
        with pytest.raises(LLMError):
            await generate_response("hi", CONTEXT, [])

    async def test_malformed_json_raises_llmerror(self, live_mode, monkeypatch):
        monkeypatch.setattr(
            llm_client.litellm, "completion", lambda **k: _fake_response("{bad json")
        )
        with pytest.raises(LLMError):
            await generate_response("hi", CONTEXT, [])

    async def test_none_content_raises_llmerror(self, live_mode, monkeypatch):
        monkeypatch.setattr(llm_client.litellm, "completion", lambda **k: _fake_response(None))
        with pytest.raises(LLMError):
            await generate_response("hi", CONTEXT, [])


# ---------- mock mode ----------


class TestMockMode:
    @pytest.mark.parametrize("value", ["true", "TRUE", "1"])
    async def test_no_network(self, monkeypatch, no_network, value):
        monkeypatch.setenv("LLM_MOCK", value)
        r = await generate_response("hello", CONTEXT, [])
        assert r.message == DEFAULT_MOCK_MESSAGE

    async def test_buy(self, mock_mode, no_network):
        r = await generate_response("Buy 10 aapl", CONTEXT, [])
        assert r.message == "Buying 10 shares of AAPL."
        assert len(r.trades) == 1
        t = r.trades[0]
        assert (t.ticker, t.side, t.quantity) == ("AAPL", "buy", 10.0)
        assert r.watchlist_changes == []

    def test_sell_fractional(self):
        r = mock_response("please SELL 2.5 TSLA now")
        t = r.trades[0]
        assert (t.ticker, t.side, t.quantity) == ("TSLA", "sell", 2.5)
        assert r.message == "Selling 2.5 shares of TSLA."

    def test_add(self):
        r = mock_response("add pypl")
        assert r.trades == []
        assert r.watchlist_changes[0].ticker == "PYPL"
        assert r.watchlist_changes[0].action == "add"

    def test_remove(self):
        r = mock_response("Remove NFLX")
        assert r.watchlist_changes[0].ticker == "NFLX"
        assert r.watchlist_changes[0].action == "remove"

    @pytest.mark.parametrize("msg", ["how is my portfolio?", "buy some apple", "address"])
    def test_default(self, msg):
        r = mock_response(msg)
        assert r.message == DEFAULT_MOCK_MESSAGE
        assert r.trades == [] and r.watchlist_changes == []

    def test_deterministic(self):
        assert mock_response("buy 3 MSFT") == mock_response("buy 3 MSFT")
