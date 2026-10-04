"""LLM client: LiteLLM -> OpenRouter -> Cerebras with structured outputs."""

import asyncio
import logging
import os
from typing import Any

import litellm
from pydantic import ValidationError

from .mock import mock_response
from .models import ChatResponse, LLMOutputSchema
from .prompts import build_messages

logger = logging.getLogger(__name__)

MODEL = "openrouter/openai/gpt-oss-120b"
EXTRA_BODY = {"provider": {"order": ["cerebras"]}}
REQUEST_TIMEOUT_SECONDS = 60


class LLMError(Exception):
    """Raised when the LLM call fails or returns an invalid response."""


def is_mock_mode() -> bool:
    return os.environ.get("LLM_MOCK", "").strip().lower() in ("1", "true", "yes")


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rstrip()
        if text.endswith("```"):
            text = text[:-3]
    return text.strip()


def parse_response(content: str | None) -> ChatResponse:
    """Parse raw LLM text content into a ChatResponse, raising LLMError on failure."""
    if not content or not content.strip():
        raise LLMError("Empty response from LLM")
    try:
        return ChatResponse.model_validate_json(_strip_code_fences(content))
    except ValidationError as exc:
        raise LLMError(f"Invalid structured output: {exc}") from exc


def _call_llm(messages: list[dict[str, str]]) -> str | None:
    response = litellm.completion(
        model=MODEL,
        messages=messages,
        response_format=LLMOutputSchema,
        reasoning_effort="low",
        extra_body=EXTRA_BODY,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    return response.choices[0].message.content


async def generate_response(
    user_message: str,
    portfolio_context: dict[str, Any],
    history: list[dict[str, Any]],
) -> ChatResponse:
    """Generate a structured chat response. Raises LLMError on any failure."""
    if is_mock_mode():
        return mock_response(user_message)

    messages = build_messages(user_message, portfolio_context, history)
    try:
        content = await asyncio.to_thread(_call_llm, messages)
    except Exception as exc:
        logger.warning("LLM call failed: %s", type(exc).__name__)
        raise LLMError(f"LLM call failed: {type(exc).__name__}") from exc
    return parse_response(content)
