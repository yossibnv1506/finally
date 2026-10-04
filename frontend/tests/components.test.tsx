import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import WatchlistRow, { FLASH_MS } from "@/components/WatchlistRow";
import Watchlist from "@/components/Watchlist";
import ChatPanel from "@/components/ChatPanel";
import Header from "@/components/Header";
import Heatmap from "@/components/Heatmap";
import PositionsTable from "@/components/PositionsTable";
import TradeBar from "@/components/TradeBar";
import type { ChatMessage, Position, WatchlistItem } from "@/lib/types";

const rowProps = {
  ticker: "AAPL",
  changePercent: 0.5,
  history: undefined,
  selected: false,
  onSelect: () => {},
  onRemove: () => {},
};

describe("WatchlistRow price flash", () => {
  it("flashes green on uptick and clears after the hold so the CSS fade runs", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ul>
        <WatchlistRow {...rowProps} price={100} />
      </ul>,
    );
    const price = screen.getByTestId("watchlist-price-AAPL");
    expect(price).toHaveTextContent("100.00");
    expect(price.className).not.toMatch(/flash-/);

    rerender(
      <ul>
        <WatchlistRow {...rowProps} price={101} />
      </ul>,
    );
    expect(price).toHaveClass("flash-up");
    expect(price).toHaveAttribute("data-flash", "up");

    act(() => {
      vi.advanceTimersByTime(FLASH_MS + 10);
    });
    expect(price.className).not.toMatch(/flash-/);
  });

  it("flashes red on downtick and not on an unchanged price", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ul>
        <WatchlistRow {...rowProps} price={100} />
      </ul>,
    );
    rerender(
      <ul>
        <WatchlistRow {...rowProps} price={99} />
      </ul>,
    );
    const price = screen.getByTestId("watchlist-price-AAPL");
    expect(price).toHaveClass("flash-down");
    act(() => {
      vi.advanceTimersByTime(FLASH_MS + 10);
    });
    rerender(
      <ul>
        <WatchlistRow {...rowProps} price={99} />
      </ul>,
    );
    expect(price.className).not.toMatch(/flash-/);
  });
});

const items: WatchlistItem[] = [
  { ticker: "AAPL", price: 190, previous_price: 189, change: 1, change_percent: 0.5, direction: "up" },
  { ticker: "MSFT", price: null, previous_price: null, change: null, change_percent: null, direction: null },
];

describe("Watchlist", () => {
  const setup = () => {
    const onAdd = vi.fn(async (_t: string) => {});
    const onRemove = vi.fn(async (_t: string) => {});
    const onSelect = vi.fn();
    render(
      <Watchlist
        items={items}
        prices={{}}
        history={{}}
        selected="AAPL"
        onSelect={onSelect}
        onAdd={onAdd}
        onRemove={onRemove}
      />,
    );
    return { onAdd, onRemove, onSelect };
  };

  it("renders a row per ticker with prices", () => {
    setup();
    expect(screen.getByTestId("watchlist")).toBeInTheDocument();
    expect(screen.getByTestId("watchlist-price-AAPL")).toHaveTextContent("190.00");
    expect(screen.getByTestId("watchlist-price-MSFT")).toHaveTextContent("—");
    expect(screen.getByTestId("watchlist-row-AAPL")).toHaveAttribute("data-selected", "true");
  });

  it("adds an uppercased ticker", async () => {
    const { onAdd } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("watchlist-add-input"), "pypl");
    await user.click(screen.getByTestId("watchlist-add-button"));
    expect(onAdd).toHaveBeenCalledWith("PYPL");
    expect(screen.getByTestId("watchlist-add-input")).toHaveValue("");
  });

  it("rejects duplicates and invalid symbols without calling the API", async () => {
    const { onAdd } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("watchlist-add-input"), "aapl");
    await user.click(screen.getByTestId("watchlist-add-button"));
    expect(screen.getByTestId("watchlist-error")).toHaveTextContent("already on your watchlist");
    await user.clear(screen.getByTestId("watchlist-add-input"));
    await user.type(screen.getByTestId("watchlist-add-input"), "AB1");
    await user.click(screen.getByTestId("watchlist-add-button"));
    expect(screen.getByTestId("watchlist-error")).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("removes and selects tickers", async () => {
    const { onRemove, onSelect } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("watchlist-remove-MSFT"));
    expect(onRemove).toHaveBeenCalledWith("MSFT");
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("watchlist-row-MSFT"));
    expect(onSelect).toHaveBeenCalledWith("MSFT");
  });

  it("shows the server error when add fails", async () => {
    const onAdd = vi.fn(async () => {
      throw new Error("Invalid ticker");
    });
    render(
      <Watchlist items={[]} prices={{}} history={{}} selected={null} onSelect={() => {}} onAdd={onAdd} onRemove={async () => {}} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByTestId("watchlist-add-input"), "ZZZ");
    await user.click(screen.getByTestId("watchlist-add-button"));
    expect(await screen.findByTestId("watchlist-error")).toHaveTextContent("Invalid ticker");
  });
});

describe("Header", () => {
  it("shows totals and connection status", () => {
    const { rerender } = render(
      <Header totalValue={10234.5} cash={4000} unrealizedPnl={234.5} unrealizedPnlPercent={2.3} status="connected" />,
    );
    expect(screen.getByTestId("header-total-value")).toHaveTextContent("$10,234.50");
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$4,000.00");
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
    rerender(<Header totalValue={null} cash={null} unrealizedPnl={null} unrealizedPnlPercent={null} status="disconnected" />);
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "disconnected");
    expect(screen.getByTestId("header-total-value")).toHaveTextContent("—");
  });
});

const positions: Position[] = [
  { ticker: "AAPL", quantity: 10, avg_cost: 100, current_price: 110, market_value: 1100, unrealized_pnl: 100, unrealized_pnl_percent: 10, weight: 0.45 },
  { ticker: "TSLA", quantity: 4.5, avg_cost: 200, current_price: 200, market_value: 900, unrealized_pnl: 0, unrealized_pnl_percent: 0, weight: 0.37 },
  { ticker: "NFLX", quantity: 1, avg_cost: 500, current_price: 450, market_value: 450, unrealized_pnl: -50, unrealized_pnl_percent: -10, weight: 0.18 },
];

describe("Positions and heatmap", () => {
  it("renders a row per position with P&L", () => {
    render(<PositionsTable positions={positions} />);
    expect(screen.getByTestId("positions-table")).toBeInTheDocument();
    expect(screen.getByTestId("position-row-AAPL")).toHaveTextContent("AAPL");
    expect(screen.getByTestId("position-qty-TSLA")).toHaveTextContent("4.5");
    expect(screen.getByTestId("position-pnl-AAPL")).toHaveTextContent("+$100.00");
    expect(screen.getByTestId("position-pnl-NFLX")).toHaveTextContent("−$50.00");
  });

  it("shows an empty state", () => {
    render(<PositionsTable positions={[]} />);
    expect(screen.getByText(/No open positions/)).toBeInTheDocument();
  });

  it("colors heatmap tiles by P&L", () => {
    render(<Heatmap positions={positions} />);
    const map = screen.getByTestId("portfolio-heatmap");
    expect(within(map).getByTestId("heatmap-tile-AAPL")).toHaveAttribute("data-pnl", "profit");
    expect(within(map).getByTestId("heatmap-tile-NFLX")).toHaveAttribute("data-pnl", "loss");
    expect(within(map).getByTestId("heatmap-tile-AAPL").style.backgroundColor).toMatch(/rgba\(38, 166, 104/);
    expect(within(map).getByTestId("heatmap-tile-NFLX").style.backgroundColor).toMatch(/rgba\(219, 68, 75/);
  });
});

describe("TradeBar", () => {
  it("submits buy and sell orders and shows confirmation", async () => {
    const onTrade = vi.fn(async (_t: string, q: number, _s: string) => ({ price: 190, quantity: q }));
    render(<TradeBar selectedTicker="AAPL" lastPrice={() => 190} onTrade={onTrade} />);
    const user = userEvent.setup();
    expect(screen.getByTestId("trade-ticker-input")).toHaveValue("AAPL");
    await user.type(screen.getByTestId("trade-quantity-input"), "2.5");
    await user.click(screen.getByTestId("trade-buy-button"));
    expect(onTrade).toHaveBeenCalledWith("AAPL", 2.5, "buy");
    expect(await screen.findByTestId("trade-confirmation")).toHaveTextContent("Bought 2.5 AAPL at 190.00");
    await user.type(screen.getByTestId("trade-quantity-input"), "1");
    await user.click(screen.getByTestId("trade-sell-button"));
    expect(onTrade).toHaveBeenLastCalledWith("AAPL", 1, "sell");
  });

  it("validates quantity and shows server errors", async () => {
    const onTrade = vi.fn(async () => {
      throw new Error("Insufficient cash");
    });
    render(<TradeBar selectedTicker="AAPL" lastPrice={() => null} onTrade={onTrade} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("trade-buy-button"));
    expect(screen.getByTestId("trade-error")).toHaveTextContent("quantity");
    expect(onTrade).not.toHaveBeenCalled();
    await user.type(screen.getByTestId("trade-quantity-input"), "1000");
    await user.click(screen.getByTestId("trade-buy-button"));
    expect(await screen.findByTestId("trade-error")).toHaveTextContent("Insufficient cash");
  });
});

const chatMessages: ChatMessage[] = [
  { id: "1", role: "user", content: "Buy 10 AAPL", actions: null, created_at: "" },
  {
    id: "2",
    role: "assistant",
    content: "Buying 10 shares of AAPL.",
    actions: {
      trades: [
        { ticker: "AAPL", side: "buy", quantity: 10, price: 190, status: "executed", error: null },
        { ticker: "TSLA", side: "sell", quantity: 5, price: null, status: "failed", error: "Insufficient shares" },
      ],
      watchlist_changes: [{ ticker: "PYPL", action: "add", status: "executed", error: null }],
    },
    created_at: "",
  },
];

describe("ChatPanel", () => {
  it("renders messages with roles and inline action confirmations", () => {
    render(<ChatPanel messages={chatMessages} loading={false} onSend={() => {}} collapsed={false} onToggle={() => {}} />);
    const msgs = screen.getAllByTestId("chat-message");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toHaveAttribute("data-role", "user");
    expect(msgs[1]).toHaveAttribute("data-role", "assistant");
    const actions = screen.getAllByTestId("chat-action");
    expect(actions).toHaveLength(3);
    expect(actions[0]).toHaveTextContent("Bought 10 AAPL at 190.00");
    expect(actions[1]).toHaveAttribute("data-status", "failed");
    expect(actions[1]).toHaveTextContent("Insufficient shares");
    expect(actions[2]).toHaveTextContent("Added PYPL to watchlist");
    expect(screen.queryByTestId("chat-loading")).not.toBeInTheDocument();
  });

  it("shows the loading indicator and disables sending while waiting", () => {
    render(<ChatPanel messages={[]} loading onSend={() => {}} collapsed={false} onToggle={() => {}} />);
    expect(screen.getByTestId("chat-loading")).toBeInTheDocument();
    expect(screen.getByTestId("chat-send-button")).toBeDisabled();
  });

  it("sends trimmed input via button and Enter", async () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} loading={false} onSend={onSend} collapsed={false} onToggle={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId("chat-input"), "  hello  ");
    await user.click(screen.getByTestId("chat-send-button"));
    expect(onSend).toHaveBeenCalledWith("hello");
    expect(screen.getByTestId("chat-input")).toHaveValue("");
    await user.type(screen.getByTestId("chat-input"), "again{Enter}");
    expect(onSend).toHaveBeenLastCalledWith("again");
  });

  it("collapses to a slim bar", () => {
    const onToggle = vi.fn();
    render(<ChatPanel messages={[]} loading={false} onSend={() => {}} collapsed onToggle={onToggle} />);
    expect(screen.getByTestId("chat-panel")).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByTestId("chat-input")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chat-toggle"));
    expect(onToggle).toHaveBeenCalled();
  });
});
