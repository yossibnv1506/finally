"""Pydantic models for the LLM chat structured output."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class TradeRequest(BaseModel):
    """A trade the LLM wants to execute (always expressed in shares)."""

    ticker: str
    side: Literal["buy", "sell"]
    quantity: float

    @field_validator("ticker")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.strip().upper()


class WatchlistChange(BaseModel):
    """A watchlist modification the LLM wants to make."""

    ticker: str
    action: Literal["add", "remove"]

    @field_validator("ticker")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.strip().upper()


class ChatResponse(BaseModel):
    """Parsed structured response from the LLM."""

    message: str
    trades: list[TradeRequest] = Field(default_factory=list)
    watchlist_changes: list[WatchlistChange] = Field(default_factory=list)


class _StrictTrade(BaseModel):
    ticker: str
    side: Literal["buy", "sell"]
    quantity: float


class _StrictWatchlistChange(BaseModel):
    ticker: str
    action: Literal["add", "remove"]


class LLMOutputSchema(BaseModel):
    """Schema sent as response_format: every field required (strict JSON-schema friendly)."""

    message: str
    trades: list[_StrictTrade]
    watchlist_changes: list[_StrictWatchlistChange]
