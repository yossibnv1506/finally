import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Terminal from "@/components/Terminal";
import type { Portfolio } from "@/lib/types";
import { MockEventSource, mockFetch, tick } from "./mocks";

const emptyPortfolio: Portfolio = {
  cash: 10000,
  total_value: 10000,
  positions_value: 0,
  unrealized_pnl: 0,
  unrealized_pnl_percent: 0,
  positions: [],
};

const afterBuy: Portfolio = {
  cash: 8100,
  total_value: 10000,
  positions_value: 1900,
  unrealized_pnl: 0,
  unrealized_pnl_percent: 0,
  positions: [
    {
      ticker: "AAPL",
      quantity: 10,
      avg_cost: 190,
      current_price: 190,
      market_value: 1900,
      unrealized_pnl: 0,
      unrealized_pnl_percent: 0,
      weight: 1,
    },
  ],
};

const watchlist = {
  tickers: [
    { ticker: "AAPL", price: 190, previous_price: 190, change: 0, change_percent: 0, direction: "flat" },
    { ticker: "MSFT", price: 420, previous_price: 420, change: 0, change_percent: 0, direction: "flat" },
  ],
};

function baseRoutes(overrides: Record<string, unknown> = {}) {
  return {
    "GET /api/portfolio": emptyPortfolio,
    "GET /api/portfolio/history": {
      snapshots: [
        { total_value: 10000, recorded_at: "2026-01-01T00:00:00Z" },
        { total_value: 10050, recorded_at: "2026-01-01T00:00:30Z" },
      ],
    },
    "GET /api/watchlist": watchlist,
    "GET /api/chat/history": {
      messages: [{ id: "m1", role: "assistant", content: "Welcome back.", actions: null, created_at: "2026-01-01T00:00:00Z" }],
    },
    ...overrides,
  };
}

const REQUIRED_TEST_IDS = [
  "connection-status",
  "header-total-value",
  "header-cash",
  "watchlist",
  "watchlist-add-input",
  "watchlist-add-button",
  "main-chart",
  "main-chart-ticker",
  "trade-ticker-input",
  "trade-quantity-input",
  "trade-buy-button",
  "trade-sell-button",
  "positions-table",
  "portfolio-heatmap",
  "pnl-chart",
  "chat-panel",
  "chat-input",
  "chat-send-button",
];

describe("Terminal", () => {
  it("renders every contract data-testid with data from the API", async () => {
    mockFetch(baseRoutes());
    render(<Terminal />);
    for (const id of REQUIRED_TEST_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(await screen.findByTestId("watchlist-row-AAPL")).toBeInTheDocument();
    expect(screen.getByTestId("watchlist-price-AAPL")).toBeInTheDocument();
    expect(screen.getByTestId("watchlist-remove-MSFT")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("header-total-value")).toHaveTextContent("$10,000.00"));
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$10,000.00");
    expect(screen.getByTestId("main-chart-ticker")).toHaveTextContent("AAPL");
    const msg = await screen.findByTestId("chat-message");
    expect(msg).toHaveAttribute("data-role", "assistant");
    expect(msg).toHaveTextContent("Welcome back.");
    await waitFor(() => expect(screen.getByTestId("pnl-chart-points")).toHaveAttribute("data-count", "2"));
  });

  it("tracks the SSE connection state and streams prices into the watchlist", async () => {
    mockFetch(baseRoutes());
    render(<Terminal />);
    await screen.findByTestId("watchlist-row-AAPL");
    const status = screen.getByTestId("connection-status");
    expect(status).toHaveAttribute("data-status", "reconnecting");

    const es = MockEventSource.latest;
    expect(es.url).toBe("/api/stream/prices");
    es.open();
    expect(status).toHaveAttribute("data-status", "connected");

    es.emit({ AAPL: tick("AAPL", 191.5, 190, 1000) });
    expect(screen.getByTestId("watchlist-price-AAPL")).toHaveTextContent("191.50");
    expect(screen.getByTestId("watchlist-price-AAPL")).toHaveClass("flash-up");

    es.fail(MockEventSource.CONNECTING);
    expect(status).toHaveAttribute("data-status", "reconnecting");
    es.open();
    expect(status).toHaveAttribute("data-status", "connected");
  });

  it("reopens the stream after the browser gives up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch(baseRoutes());
    render(<Terminal />);
    const first = MockEventSource.latest;
    first.fail(MockEventSource.CLOSED);
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "disconnected");
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(MockEventSource.instances.length).toBe(2);
    MockEventSource.latest.open();
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  });

  it("buys shares, updating cash and positions, and revalues on ticks", async () => {
    const fetchSpy = mockFetch(
      baseRoutes({
        "POST /api/portfolio/trade": {
          trade: { id: "t1", ticker: "AAPL", side: "buy", quantity: 10, price: 190, executed_at: "2026-01-01T00:01:00Z" },
          portfolio: afterBuy,
        },
      }),
    );
    render(<Terminal />);
    await screen.findByTestId("watchlist-row-AAPL");
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("trade-ticker-input")).toHaveValue("AAPL"));
    await user.clear(screen.getByTestId("trade-ticker-input"));
    await user.type(screen.getByTestId("trade-ticker-input"), "aapl");
    await user.type(screen.getByTestId("trade-quantity-input"), "10");
    await user.click(screen.getByTestId("trade-buy-button"));

    const row = await screen.findByTestId("position-row-AAPL");
    expect(row).toHaveTextContent("AAPL");
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$8,100.00");
    const call = fetchSpy.mock.calls.find(([url, init]) => url === "/api/portfolio/trade" && init?.method === "POST");
    expect(JSON.parse(String(call![1]!.body))).toEqual({ ticker: "AAPL", quantity: 10, side: "buy" });
    expect(within(screen.getByTestId("portfolio-heatmap")).getByTestId("heatmap-tile-AAPL")).toBeInTheDocument();

    MockEventSource.latest.emit({ AAPL: tick("AAPL", 200, 190, 2000) });
    expect(screen.getByTestId("header-total-value")).toHaveTextContent("$10,100.00");
    expect(screen.getByTestId("position-pnl-AAPL")).toHaveTextContent("+$100.00");
  });

  it("shows the API error when a trade is rejected", async () => {
    mockFetch(
      baseRoutes({
        "POST /api/portfolio/trade": () => ({ status: 400, body: { detail: "Insufficient cash" } }),
      }),
    );
    render(<Terminal />);
    await screen.findByTestId("watchlist-row-AAPL");
    const user = userEvent.setup();
    await user.type(screen.getByTestId("trade-quantity-input"), "1000");
    await user.click(screen.getByTestId("trade-buy-button"));
    expect(await screen.findByTestId("trade-error")).toHaveTextContent("Insufficient cash");
  });

  it("adds and removes watchlist tickers through the API", async () => {
    let tickers = [...watchlist.tickers];
    const fetchSpy = mockFetch(
      baseRoutes({
        "GET /api/watchlist": () => ({ body: { tickers } }),
        "POST /api/watchlist": (init: RequestInit | undefined) => {
          const { ticker } = JSON.parse(String(init?.body));
          tickers = [...tickers, { ticker, price: null, previous_price: null, change: null, change_percent: null, direction: null } as never];
          return { status: 201, body: { ticker } };
        },
        "DELETE /api/watchlist/MSFT": () => {
          tickers = tickers.filter((t) => t.ticker !== "MSFT");
          return { body: { ticker: "MSFT" } };
        },
      }),
    );
    render(<Terminal />);
    await screen.findByTestId("watchlist-row-MSFT");
    const user = userEvent.setup();
    await user.type(screen.getByTestId("watchlist-add-input"), "pypl");
    await user.click(screen.getByTestId("watchlist-add-button"));
    expect(await screen.findByTestId("watchlist-row-PYPL")).toBeInTheDocument();
    expect(screen.getByTestId("main-chart-ticker")).toHaveTextContent("PYPL");

    await user.click(screen.getByTestId("watchlist-remove-MSFT"));
    await waitFor(() => expect(screen.queryByTestId("watchlist-row-MSFT")).not.toBeInTheDocument());
    expect(fetchSpy.mock.calls.some(([url, init]) => url === "/api/watchlist/MSFT" && init?.method === "DELETE")).toBe(true);
  });

  it("sends a chat message, shows loading, then the reply with inline actions", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const portfolioCalls = vi.fn();
    const routes = baseRoutes({
      "GET /api/chat/history": { messages: [] },
      "GET /api/portfolio": () => {
        portfolioCalls();
        return { body: emptyPortfolio };
      },
      "POST /api/chat": {
        message: "Buying 5 shares of NVDA.",
        trades: [{ ticker: "NVDA", side: "buy", quantity: 5, price: 800, status: "executed", error: null }],
        watchlist_changes: [],
      },
    });
    const spy = mockFetch(routes);
    const inner = spy.getMockImplementation()!;
    spy.mockImplementation(async (input, init) => {
      if (input === "/api/chat") await gate;
      return inner(input, init);
    });

    render(<Terminal />);
    await screen.findByTestId("watchlist-row-AAPL");
    const callsBefore = portfolioCalls.mock.calls.length;
    const user = userEvent.setup();
    await user.type(screen.getByTestId("chat-input"), "buy 5 NVDA");
    await user.click(screen.getByTestId("chat-send-button"));

    expect(await screen.findByTestId("chat-loading")).toBeInTheDocument();
    const userMsg = screen.getAllByTestId("chat-message")[0];
    expect(userMsg).toHaveAttribute("data-role", "user");
    expect(userMsg).toHaveTextContent("buy 5 NVDA");

    await act(async () => release());
    await waitFor(() => expect(screen.queryByTestId("chat-loading")).not.toBeInTheDocument());
    const msgs = screen.getAllByTestId("chat-message");
    expect(msgs[1]).toHaveAttribute("data-role", "assistant");
    expect(msgs[1]).toHaveTextContent("Buying 5 shares of NVDA.");
    expect(screen.getByTestId("chat-action")).toHaveTextContent("Bought 5 NVDA at 800.00");
    await waitFor(() => expect(portfolioCalls.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("shows a readable message when the chat request fails", async () => {
    mockFetch(baseRoutes({ "POST /api/chat": () => ({ status: 500, body: { detail: "boom" } }) }));
    render(<Terminal />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId("chat-input"), "hello");
    await user.click(screen.getByTestId("chat-send-button"));
    await waitFor(() => expect(screen.getAllByTestId("chat-message").at(-1)).toHaveTextContent("Couldn't reach the assistant"));
  });
});
