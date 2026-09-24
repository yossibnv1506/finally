# FinAlly — AI Trading Workstation

A visually stunning AI-powered trading workstation that streams live market data, simulates portfolio trading, and integrates an LLM chat assistant that can analyze positions and execute trades via natural language.

Built entirely by coding agents as a capstone project for an agentic AI coding course. Full spec: [`planning/PLAN.md`](planning/PLAN.md).

## Status

🚧 In progress. The **market data subsystem** (`backend/app/market/`) is complete, tested, and reviewed — see [`planning/MARKET_DATA_SUMMARY.md`](planning/MARKET_DATA_SUMMARY.md). Everything else described below (API, database, frontend, chat, Docker packaging, tests) is planned but not yet built.

## Planned Features

- **Live price streaming** via SSE with green/red flash animations
- **Simulated portfolio** — $10k virtual cash, market orders, instant fills
- **Portfolio visualizations** — heatmap (treemap), P&L chart, positions table
- **AI chat assistant** — analyzes holdings, suggests and auto-executes trades
- **Watchlist management** — track tickers manually or via AI
- **Dark terminal aesthetic** — Bloomberg-inspired, data-dense layout

## Architecture

Single Docker container serving everything on port 8000:

- **Frontend**: Next.js (static export) with TypeScript and Tailwind CSS — not yet built
- **Backend**: FastAPI (Python/uv) with SSE streaming — market data done, API routes not yet built
- **Database**: SQLite with lazy initialization — not yet built
- **AI**: LiteLLM → OpenRouter (Cerebras inference) with structured outputs — not yet built
- **Market data**: Built-in GBM simulator (default) or Massive API (optional) — ✅ done

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key for AI chat |
| `MASSIVE_API_KEY` | No | Massive (Polygon.io) key for real market data; omit to use simulator |
| `LLM_MOCK` | No | Set `true` for deterministic mock LLM responses (testing) |

## Project Structure

```
finally/
├── backend/     # FastAPI uv project (market data implemented; API/DB/AI pending)
├── planning/    # Project documentation and agent contracts
└── db/          # SQLite volume mount (runtime, not yet used)
```

`frontend/`, `scripts/`, and `test/` are planned per [`planning/PLAN.md`](planning/PLAN.md) but don't exist yet.

## License

See [LICENSE](LICENSE).
