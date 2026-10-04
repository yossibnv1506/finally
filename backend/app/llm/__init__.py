"""LLM integration for the FinAlly chat assistant."""

from .client import MODEL, LLMError, generate_response, is_mock_mode, parse_response
from .mock import DEFAULT_MOCK_MESSAGE, mock_response
from .models import ChatResponse, TradeRequest, WatchlistChange
from .prompts import SYSTEM_PROMPT, build_messages

__all__ = [
    "DEFAULT_MOCK_MESSAGE",
    "MODEL",
    "SYSTEM_PROMPT",
    "ChatResponse",
    "LLMError",
    "TradeRequest",
    "WatchlistChange",
    "build_messages",
    "generate_response",
    "is_mock_mode",
    "mock_response",
    "parse_response",
]
