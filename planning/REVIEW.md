# Plan Review: FinAlly

## Overall assessment

The plan has a clear, well-scoped demo goal and sensible defaults: simulator-first market data, a single container, SSE, and simulated market orders all reduce operational complexity. The main remaining risks are not feature gaps; they are contracts that need to be made explicit before frontend and backend are implemented independently.

## Must resolve before implementation

1. **Define the API contract, not just endpoint names.** Each endpoint needs request and response examples, field types, validation rules, and error status codes. Specify the portfolio response, whether prices are nullable while the cache warms, trade failures (`400` vs. `409`), duplicate watchlist adds, ticker normalization, and the exact SSE event name/payload. This should be the shared frontend/backend source of truth.

2. **Make trade execution atomic.** A manual trade must read one current price, validate cash/holdings, update cash and positions, append the trade, and write its snapshot in one SQLite transaction. Also choose LLM-batch semantics: validate and commit all actions atomically, or explicitly make it ordered best-effort and return per-action results. Without this, concurrent requests or partial batches can leave balances and history inconsistent.

3. **Specify arithmetic and position rules.** Currency should not use binary `REAL` for user-visible balances and P&L. Use integer minor units or `Decimal` with a defined rounding policy; share quantities can use bounded decimal precision. State the weighted-average-cost formula, sell behavior, zero-position deletion, and whether realized P&L is retained. The current schema only supports unrealized P&L, which is fine if intentional.

4. **Resolve the database persistence contradiction.** Section 4 describes a repo-root `db/` mount target, while Section 11's command uses the named volume `finally-data:/app/db`; the latter does not populate `./db`. Pick one documented default and align scripts, Dockerfile, `.gitignore`, and recovery/reset instructions.

5. **Fix text encoding before using this as an agent contract.** Arrow and box-drawing characters render as mojibake throughout the plan. Save it as UTF-8 and verify it renders cleanly; otherwise copied values and section references will be error-prone.

## Important design clarifications

- **Chat persistence:** `chat_messages` is persisted, but the API lacks a history endpoint. Decide whether chat should survive refreshes. If yes, add a paginated `GET /api/chat/messages`; if no, qualify the persistence expectation and retain it only for model context/audit.

- **LLM action safety:** Treat LLM output as an untrusted request, even with structured output. Normalize tickers, cap action count and quantity, apply server-side validation, and return actual execution results rather than requested actions. A malformed or stale dollar-to-shares conversion must fail cleanly. Mock and live modes should use the same response contract.

- **Market-data lifecycle:** Define cache warm-up behavior, stale-price thresholds, timestamp time zone, and what happens when a ticker is newly added, removed, or fully sold. The tracked-universe rule should explicitly say when an unneeded ticker is evicted and whether its final cached value remains visible.

- **Massive integration:** Name the exact Massive endpoint(s), expected response shape, exchange/session assumptions, and rate-limit/backoff behavior. Clarify whether displayed daily change means prior-close change or change since application start; the simulator needs a consistent synthetic prior close. Do not present simulator ticks as real-time market data when the optional provider is unavailable or stale.

- **SSE reliability:** Specify a heartbeat/comment interval, reconnect retry policy, initial snapshot event, cache-control/proxy-buffering headers, and cleanup of disconnected clients. EventSource reconnects automatically, but the server and UI still need enough protocol detail to correctly drive the status indicator.

- **Static-export serving:** Define the FastAPI static-file fallback for client-side routes and ensure API/SSE routes take precedence. Include this in a container smoke test, alongside a clean-volume initialization test.

## Delivery and testability gaps

- Add ownership/order of work and a definition of done. The plan names broad agent roles but does not state which contract files must exist before dependent work begins, nor required build/test commands.
- Add a deterministic simulator control (seed and/or clock) for unit and E2E tests. `LLM_MOCK=true` alone does not make price-driven UI or portfolio tests reproducible.
- Test restart recovery with an existing database, not only a fresh start; include malformed DB/schema-version behavior. Lazy initialization needs an explicit migration/version policy or a declared development-only reset policy.
- Test API validation and transaction invariants directly: no negative cash, no negative holdings, exactly one trade row per successful action, and portfolio snapshots consistent with committed state.
- Define empty states: no positions (heatmap), no snapshots yet (P&L), initial price-cache warm-up, and an unavailable LLM key. These are normal first-launch states and should not render as errors.

## Recommended plan edits

1. Add a versioned `planning/API_CONTRACT.md` containing REST/SSE schemas and examples.
2. Add a short trading-invariants and transaction-semantics subsection to Sections 7-9.
3. Choose named volume or bind mount, then correct Sections 4 and 11.
4. Add market-data freshness/session semantics and SSE protocol details to Section 6.
5. Add deterministic test controls and a concise build/test acceptance checklist to Section 12.

The existing Section 13 already identifies useful smaller ambiguities (weighted average cost, batch ordering, chat history, and persistence). The issues above prioritize the ones that should become explicit contractual requirements rather than remain review notes.
