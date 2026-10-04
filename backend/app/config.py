"""Environment / path configuration for the FinAlly backend."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# backend/app/config.py -> parents[0]=app, [1]=backend, [2]=project root
BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent

SNAPSHOT_INTERVAL_SECONDS = 30.0


def load_env() -> None:
    """Load `.env` from the project root without overriding existing env vars."""
    env_file = PROJECT_ROOT / ".env"
    if env_file.is_file():
        load_dotenv(env_file, override=False)


def get_db_path() -> str:
    """SQLite path: `DB_PATH` env var, else `<project_root>/db/finally.db`."""
    override = os.environ.get("DB_PATH", "").strip()
    if override:
        return override
    return str(PROJECT_ROOT / "db" / "finally.db")


def get_static_dir() -> Path:
    """Frontend static export dir: `STATIC_DIR` env var, else `backend/static`."""
    override = os.environ.get("STATIC_DIR", "").strip()
    if override:
        return Path(override)
    return BACKEND_DIR / "static"


def llm_mock_enabled() -> bool:
    return os.environ.get("LLM_MOCK", "").strip().lower() in {"1", "true", "yes", "on"}
