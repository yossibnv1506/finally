"""REST API routers (see planning/CONTRACTS.md, "REST API")."""

from fastapi import APIRouter

from . import chat, health, portfolio, watchlist

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(portfolio.router)
api_router.include_router(watchlist.router)
api_router.include_router(chat.router)

__all__ = ["api_router"]
