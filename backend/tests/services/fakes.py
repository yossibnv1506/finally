"""Test doubles shared by services and API tests."""

from __future__ import annotations

from app.market import MarketDataSource, PriceCache

DEFAULT_PRICES = {
    "AAPL": 190.0,
    "GOOGL": 175.0,
    "MSFT": 420.0,
    "AMZN": 185.0,
    "TSLA": 250.0,
    "NVDA": 120.0,
    "META": 500.0,
    "JPM": 200.0,
    "V": 280.0,
    "NFLX": 650.0,
}


class FakeSource(MarketDataSource):
    """Deterministic market source: seeds fixed prices, records calls."""

    def __init__(self, cache: PriceCache, prices: dict | None = None, unpriced=()):
        self.cache = cache
        self.prices = dict(DEFAULT_PRICES if prices is None else prices)
        self.unpriced = set(unpriced)
        self.tickers: list[str] = []
        self.added: list[str] = []
        self.removed: list[str] = []
        self.started = False
        self.stopped = False

    def _seed(self, ticker: str) -> None:
        if ticker not in self.unpriced:
            self.cache.update(ticker, self.prices.get(ticker, 100.0))

    async def start(self, tickers: list[str]) -> None:
        self.started = True
        for t in tickers:
            if t not in self.tickers:
                self.tickers.append(t)
                self._seed(t)

    async def stop(self) -> None:
        self.stopped = True

    async def add_ticker(self, ticker: str) -> None:
        self.added.append(ticker)
        if ticker not in self.tickers:
            self.tickers.append(ticker)
            self._seed(ticker)

    async def remove_ticker(self, ticker: str) -> None:
        self.removed.append(ticker)
        if ticker in self.tickers:
            self.tickers.remove(ticker)
        self.cache.remove(ticker)

    def get_tickers(self) -> list[str]:
        return list(self.tickers)
