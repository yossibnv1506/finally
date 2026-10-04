# syntax=docker/dockerfile:1
# FinAlly — multi-stage build (PLAN.md §11)

# ---------- Stage 1: build the Next.js static export ----------
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend

# Install deps first for better layer caching
COPY frontend/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY frontend/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# Static export is produced in /app/frontend/out (output: 'export')

# ---------- Stage 2: Python runtime with uv ----------
FROM python:3.12-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app/backend

# Install dependencies only (cached layer), then the project itself
COPY backend/pyproject.toml backend/uv.lock backend/README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ ./
RUN uv sync --frozen --no-dev

# Frontend static export served by FastAPI
COPY --from=frontend-build /app/frontend/out /app/backend/static

# SQLite lives on the named volume mounted at /app/db
RUN mkdir -p /app/db
VOLUME ["/app/db"]

ENV PATH="/app/backend/.venv/bin:$PATH" \
    DB_PATH=/app/db/finally.db \
    STATIC_DIR=/app/backend/static

EXPOSE 8000

# python:slim has no curl — use the stdlib for the health probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)" || exit 1

CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
