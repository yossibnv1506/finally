"""FinAlly FastAPI application.

Run locally:  cd backend && uv run uvicorn app.main:app --port 8000
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import config
from app.api import api_router
from app.market import MarketDataSource, PriceCache, create_market_data_source, create_stream_router

logger = logging.getLogger(__name__)

SourceFactory = Callable[[PriceCache], MarketDataSource]


async def _snapshot_loop(cache: PriceCache, interval: float) -> None:
    from app.services import record_snapshot

    while True:
        await asyncio.sleep(interval)
        try:
            record_snapshot(cache)
        except Exception:
            logger.exception("Periodic portfolio snapshot failed")


def _validation_message(exc: RequestValidationError) -> str:
    parts = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err.get("loc", ()) if p != "body")
        parts.append(f"{loc}: {err.get('msg')}" if loc else str(err.get("msg")))
    return "; ".join(parts) or "Invalid request"


def create_app(
    *,
    source_factory: SourceFactory | None = None,
    db_path: str | None = None,
    static_dir: Path | None = None,
    snapshot_interval: float | None = None,
    load_dotenv: bool = True,
) -> FastAPI:
    """Build the FastAPI app. Keyword args exist for tests; defaults read env."""
    if load_dotenv:
        config.load_env()

    cache = PriceCache()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        from app import db
        from app.services import record_snapshot, tracked_tickers

        db.init_db(db_path or config.get_db_path())

        factory = source_factory or create_market_data_source
        source = factory(cache)
        await source.start(tracked_tickers())
        app.state.market_source = source

        try:
            record_snapshot(cache)
        except Exception:
            logger.exception("Initial portfolio snapshot failed")

        interval = snapshot_interval or config.SNAPSHOT_INTERVAL_SECONDS
        snapshot_task = asyncio.create_task(_snapshot_loop(cache, interval), name="snapshots")
        try:
            yield
        finally:
            snapshot_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await snapshot_task
            await source.stop()
            app.state.market_source = None

    app = FastAPI(title="FinAlly", lifespan=lifespan)
    app.state.price_cache = cache
    app.state.market_source = None

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=400, content={"detail": _validation_message(exc)})

    app.include_router(api_router)
    # create_stream_router() registers onto a module-level router in app.market.stream,
    # so repeated calls (several apps per process, e.g. tests) would accumulate routes
    # bound to stale caches. Take just the route created for *this* cache.
    stream_router = create_stream_router(cache)
    app.router.routes.append(stream_router.routes.pop())

    static_path = static_dir if static_dir is not None else config.get_static_dir()
    if static_path.is_dir():
        app.mount("/", StaticFiles(directory=str(static_path), html=True), name="static")
    else:
        logger.info("Static dir %s not found; serving API only", static_path)

    return app


app = create_app()
