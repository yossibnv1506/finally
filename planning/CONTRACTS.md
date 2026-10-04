# FinAlly — Team Contracts

Shared contract for the agent team. PLAN.md is the spec; this file pins down the
interfaces between team members so everyone can build in parallel. If you must
change a contract, update this file and note it in your final report.

## Ownership (only edit files you own)

| Role | Owns |
|---|---|
| Database Engineer | `backend/app/db/**`, `backend/tests/db/**` |
| LLM Engineer | `backend/app/llm/**`, `backend/tests/llm/**` |
| Backend AI Engineer | `backend/app/main.py`, `backend/app/api/**`, `backend/app/services/**`, `backend/app/config.py`, `backend/tests/api/**`, `backend/tests/services/**` |
| Frontend Engineer | `frontend/**` |
| DevOps Engineer | `Dockerfile`, `.dockerignore`, `scripts/**`, `.env.example`, `db/.gitkeep`, `.gitignore` |
| Integration Tester | `test/**` (Playwright + `test/docker-compose.test.yml`) |

`backend/app/market/**` is complete — do not modify unless a bug is reported against it.
`backend/pyproject.toml` / `uv.lock` already include `litellm`, `pydantic`, `python-dotenv`, and dev `httpx`.
Do not add Python deps without good reason; if you must, only the Backend AI Engineer runs `uv add`.
Nobody runs `git commit`.

## Backend layout

```
backend/app/
  main.py            # FastAPI app: lifespan, routers, static files (Backend)
  config.py          # env loading (Backend)
  market/            # DONE
  db/                # Database Engineer
  llm/               # LLM Engineer
  services/          # portfolio/trade/watchlist logic (Backend)
  api/               # routers (Backend)
```

Run with `cd backend && uv run uvicorn app.main:app --port 8000`.
Env: `.env` at project root (load with python-dotenv, `override=False`).
`DB_PATH` env var overrides the DB file path; default `<project_root>/db/finally.db`
(in Docker `/app/db/finally.db` — Backend computes root as the parent of `backend/` locally;
in the container set `DB_PATH=/app/db/finally.db`).
`STATIC_DIR` env var overrides frontend static dir; default `backend/static`.

## Database API (`app.db`) — Database Engineer

Plain `sqlite3`, synchronous, one short-lived connection per call (or a thread-safe
module-level connection with `check_same_thread=False` + lock). All rows use
`user_id="default"`. Timestamps are ISO-8601 UTC strings. IDs are `uuid4` strings.
Schema SQL lives in `backend/app/db/schema.sql` (matches PLAN.md §7).

```python
from app.db import (
    init_db,               # init_db(db_path: str | None = None) -> None   creates dirs/tables, seeds if empty; idempotent
    get_cash,              # () -> float
    set_cash,              # (amount: float) -> None
    get_watchlist,         # () -> list[str]                      ordered by added_at
    add_watchlist_ticker,  # (ticker: str) -> bool                False if already present
    remove_watchlist_ticker,  # (ticker: str) -> bool             False if absent
    get_positions,         # () -> list[dict]  {"ticker","quantity","avg_cost","updated_at"}
    get_position,          # (ticker: str) -> dict | None
    upsert_position,       # (ticker: str, quantity: float, avg_cost: float) -> None
    delete_position,       # (ticker: str) -> None
    record_trade,          # (ticker: str, side: str, quantity: float, price: float) -> dict  the trade row
    get_trades,            # (limit: int = 100) -> list[dict]
    record_snapshot,       # (total_value: float) -> None
    get_snapshots,         # (limit: int = 1000) -> list[dict] {"total_value","recorded_at"} ascending by time
    add_chat_message,      # (role: str, content: str, actions: dict | None = None) -> dict
    get_chat_messages,     # (limit: int = 20) -> list[dict] {"id","role","content","actions"(parsed or None),"created_at"} oldest→newest, the LAST `limit`
    execute_trade_atomic,  # (ticker, side, quantity, price, new_cash, new_qty, new_avg_cost) -> dict
                           #   single transaction: update cash, upsert/delete position (delete when new_qty≈0), insert trade
)
```
Tickers are stored uppercase. `init_db()` is called by Backend in the FastAPI lifespan.
Tests use a temp DB path (pass to `init_db`).

## LLM API (`app.llm`) — LLM Engineer

Uses the `cerebras-inference` skill: LiteLLM → `openrouter/openai/gpt-oss-120b`,
`extra_body={"provider": {"order": ["cerebras"]}}`, structured outputs via Pydantic.

```python
from app.llm import ChatResponse, TradeRequest, WatchlistChange, generate_response

class TradeRequest(BaseModel):     ticker: str; side: Literal["buy","sell"]; quantity: float
class WatchlistChange(BaseModel):  ticker: str; action: Literal["add","remove"]
class ChatResponse(BaseModel):     message: str; trades: list[TradeRequest] = []; watchlist_changes: list[WatchlistChange] = []

async def generate_response(user_message: str, portfolio_context: dict, history: list[dict]) -> ChatResponse
    # history = [{"role","content"}] oldest→newest (max 20, already capped by caller)
    # Raises app.llm.LLMError on network failure / validation failure (caller handles fallback).
    # If LLM_MOCK=true: deterministic, no network. Mock rules (case-insensitive on user_message):
    #   "buy <qty> <TICKER>"  -> trades=[buy qty TICKER], message "Buying <qty> shares of <TICKER>."
    #   "sell <qty> <TICKER>" -> trades=[sell ...]
    #   "add <TICKER>"        -> watchlist_changes=[add TICKER]
    #   "remove <TICKER>"     -> watchlist_changes=[remove TICKER]
    #   otherwise             -> message "FinAlly mock response: I can help you analyze your portfolio." no actions
```
Run the blocking `litellm.completion` via `asyncio.to_thread` (or use `acompletion`).
`portfolio_context` is the same dict as `GET /api/portfolio` plus `"watchlist"` (list of `{ticker, price}`).

## REST API — Backend AI Engineer (Frontend consumes)

All JSON. Errors: HTTP 400 with `{"detail": "<human message>"}`.

- `GET /api/health` → `{"status":"ok"}`
- `GET /api/stream/prices` → SSE (existing). Each event: `data: {"AAPL": {"ticker","price","previous_price","timestamp","change","change_percent","direction"}, ...}`
- `GET /api/portfolio` →
  ```json
  {"cash": 10000.0, "total_value": 10000.0, "positions_value": 0.0,
   "unrealized_pnl": 0.0, "unrealized_pnl_percent": 0.0,
   "positions": [{"ticker","quantity","avg_cost","current_price","market_value",
                  "unrealized_pnl","unrealized_pnl_percent","weight"}]}
  ```
  (`current_price` falls back to `avg_cost` if no cached price; `weight` = market_value/total positions_value)
- `POST /api/portfolio/trade` body `{"ticker","quantity","side"}` → `{"trade": {id,ticker,side,quantity,price,executed_at}, "portfolio": <portfolio>}`;
  400 on quantity<=0, unknown price, insufficient cash, insufficient shares.
  Weighted average cost on buy: `new_avg = (old_qty*old_avg + qty*price)/(old_qty+qty)`; sell keeps avg_cost.
  Records a snapshot after each trade.
- `GET /api/portfolio/history` → `{"snapshots": [{"total_value","recorded_at"}]}`
- `GET /api/watchlist` → `{"tickers": [{"ticker","price","previous_price","change","change_percent","direction"}]}` (price fields null if not yet cached)
- `POST /api/watchlist` body `{"ticker"}` → 201 `{"ticker": "PYPL"}`; 400 if empty/invalid (`^[A-Z.]{1,10}$` after uppercasing) or duplicate
- `DELETE /api/watchlist/{ticker}` → `{"ticker": "..."}`; 404 if absent
- `GET /api/chat/history` → `{"messages": [{id, role, content, actions, created_at}]}` (last 50)
- `POST /api/chat` body `{"message"}` →
  ```json
  {"message": "...", "trades": [{"ticker","side","quantity","price","status":"executed"|"failed","error":null|"..."}],
   "watchlist_changes": [{"ticker","action","status":"executed"|"failed","error":null|"..."}]}
  ```
  LLM trades are executed best-effort in order (no rollback); failures reported per item.
  On LLMError: message `"Sorry, I couldn't process that — please try again."`, no actions, user message still stored.

Tracked ticker universe = watchlist ∪ open positions. Backend calls `source.add_ticker/remove_ticker`
whenever either changes (removing only when the ticker is in neither set — immediately).
Background task records a portfolio snapshot every 30s.
`main.py` serves the static export at `/` (with `html=True`) mounted AFTER API routers.

## Frontend — Frontend Engineer

Next.js + TypeScript + Tailwind, `output: 'export'`, build output `frontend/out/`.
Same-origin fetches to `/api/*`. For local dev, `next.config` may set rewrites only in dev mode
(not used by the export). Unit tests with Vitest + React Testing Library (`npm test`).

**Stable `data-testid`s (used by Playwright — must exist):**
- `connection-status` (attribute `data-status="connected"|"reconnecting"|"disconnected"`)
- `header-total-value`, `header-cash`
- `watchlist`, `watchlist-row-<TICKER>`, `watchlist-price-<TICKER>`, `watchlist-remove-<TICKER>`,
  `watchlist-add-input`, `watchlist-add-button`
- `main-chart` (+ `main-chart-ticker` showing the selected symbol)
- `trade-ticker-input`, `trade-quantity-input`, `trade-buy-button`, `trade-sell-button`, `trade-error`
- `positions-table`, `position-row-<TICKER>`
- `portfolio-heatmap`, `pnl-chart`
- `chat-panel`, `chat-input`, `chat-send-button`, `chat-message` (each message, with `data-role`), `chat-loading`, `chat-action` (each inline trade/watchlist confirmation)

## Docker — DevOps Engineer

Multi-stage per PLAN.md §11. Stage 1 builds `frontend/` → copies `frontend/out` to `/app/backend/static`.
Stage 2 workdir `/app/backend`, `uv sync --frozen --no-dev`, `ENV DB_PATH=/app/db/finally.db`,
CMD `uv run uvicorn app.main:app --host 0.0.0.0 --port 8000`. Image name `finally`, container name `finally`,
named volume `finally-data:/app/db`, `--env-file .env` (scripts create `.env` from `.env.example` if missing).
Healthcheck on `/api/health`.

## E2E — Integration Tester

`test/` has its own `package.json` with `@playwright/test`, `playwright.config.ts` (`baseURL` from
`BASE_URL` env, default `http://localhost:8000`), and `docker-compose.test.yml`
(app built from root Dockerfile with `LLM_MOCK=true` + `mcr.microsoft.com/playwright` runner).
Tests can also run locally against `uv run uvicorn` with `LLM_MOCK=true` when Docker is unavailable.
