"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ChatPanel from "./ChatPanel";
import Header from "./Header";
import Heatmap from "./Heatmap";
import MainChart from "./MainChart";
import PnlChart from "./PnlChart";
import PositionsTable from "./PositionsTable";
import TradeBar from "./TradeBar";
import Watchlist from "./Watchlist";
import { usePriceStream } from "@/hooks/usePriceStream";
import { api } from "@/lib/api";
import { revaluePortfolio } from "@/lib/portfolio";
import type { ChatMessage, Portfolio, Snapshot, TradeSide, WatchlistItem } from "@/lib/types";

const PORTFOLIO_REFRESH_MS = 15_000;
const HISTORY_REFRESH_MS = 30_000;
const CHAT_ERROR = "Couldn't reach the assistant. Check your connection and try again.";

let localId = 0;
const nextId = () => `local-${Date.now()}-${++localId}`;

export default function Terminal() {
  const { prices, history, status } = usePriceStream();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);

  const loadPortfolio = useCallback(async () => {
    try {
      setPortfolio(await api.getPortfolio());
    } catch {
      /* keep last known values; the next refresh retries */
    }
  }, []);
  const loadHistory = useCallback(async () => {
    try {
      setSnapshots(await api.getHistory());
    } catch {
      /* ignore */
    }
  }, []);
  const loadWatchlist = useCallback(async () => {
    try {
      const items = await api.getWatchlist();
      setWatchlist(items);
      setSelected((cur) => (cur && items.some((i) => i.ticker === cur) ? cur : cur ?? items[0]?.ticker ?? null));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadPortfolio();
    void loadHistory();
    void loadWatchlist();
    api
      .getChatHistory()
      .then(setMessages)
      .catch(() => {
        /* chat history is optional on load */
      });
    const p = setInterval(loadPortfolio, PORTFOLIO_REFRESH_MS);
    const h = setInterval(loadHistory, HISTORY_REFRESH_MS);
    return () => {
      clearInterval(p);
      clearInterval(h);
    };
  }, [loadPortfolio, loadHistory, loadWatchlist]);

  const live = useMemo(() => (portfolio ? revaluePortfolio(portfolio, prices) : null), [portfolio, prices]);

  const lastPrice = useCallback(
    (ticker: string) =>
      prices[ticker]?.price ??
      watchlist.find((w) => w.ticker === ticker)?.price ??
      portfolio?.positions.find((p) => p.ticker === ticker)?.current_price ??
      null,
    [prices, watchlist, portfolio],
  );

  const handleTrade = useCallback(
    async (ticker: string, quantity: number, side: TradeSide) => {
      const res = await api.trade(ticker, quantity, side);
      setPortfolio(res.portfolio);
      void loadHistory();
      return { price: res.trade.price, quantity: res.trade.quantity };
    },
    [loadHistory],
  );

  const handleAdd = useCallback(
    async (ticker: string) => {
      await api.addTicker(ticker);
      await loadWatchlist();
      setSelected(ticker);
    },
    [loadWatchlist],
  );

  const handleRemove = useCallback(
    async (ticker: string) => {
      await api.removeTicker(ticker);
      setWatchlist((items) => items.filter((i) => i.ticker !== ticker));
      setSelected((cur) => (cur === ticker ? null : cur));
      await loadWatchlist();
    },
    [loadWatchlist],
  );

  const handleSend = useCallback(
    async (text: string) => {
      const now = new Date().toISOString();
      setMessages((m) => [...m, { id: nextId(), role: "user", content: text, actions: null, created_at: now }]);
      setChatLoading(true);
      try {
        const res = await api.sendChat(text);
        const trades = res.trades ?? [];
        const watchlist_changes = res.watchlist_changes ?? [];
        setMessages((m) => [
          ...m,
          {
            id: nextId(),
            role: "assistant",
            content: res.message,
            actions: trades.length || watchlist_changes.length ? { trades, watchlist_changes } : null,
            created_at: new Date().toISOString(),
          },
        ]);
        if (trades.some((t) => t.status === "executed")) {
          void loadPortfolio();
          void loadHistory();
        }
        if (watchlist_changes.some((w) => w.status === "executed")) void loadWatchlist();
      } catch {
        setMessages((m) => [
          ...m,
          { id: nextId(), role: "assistant", content: CHAT_ERROR, actions: null, created_at: new Date().toISOString() },
        ]);
      } finally {
        setChatLoading(false);
      }
    },
    [loadPortfolio, loadHistory, loadWatchlist],
  );

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-[640px]">
      <Header
        totalValue={live?.total_value ?? null}
        cash={live?.cash ?? null}
        unrealizedPnl={live?.unrealized_pnl ?? null}
        unrealizedPnlPercent={live?.unrealized_pnl_percent ?? null}
        status={status}
      />
      <main
        className={`grid flex-1 grid-cols-1 gap-1 p-1 lg:min-h-0 ${
          chatCollapsed ? "lg:grid-cols-[18.5rem_minmax(0,1fr)_2.5rem]" : "lg:grid-cols-[18.5rem_minmax(0,1fr)_22rem]"
        }`}
      >
        <div className="min-h-0 max-lg:h-[420px]">
          <Watchlist
            items={watchlist}
            prices={prices}
            history={history}
            selected={selected}
            onSelect={setSelected}
            onAdd={handleAdd}
            onRemove={handleRemove}
          />
        </div>

        <div className="grid min-h-0 grid-rows-[minmax(220px,1.25fr)_auto_minmax(180px,1fr)_minmax(140px,0.8fr)] gap-1 max-lg:grid-rows-[320px_auto_auto_280px]">
          <MainChart ticker={selected} history={selected ? history[selected] : undefined} latest={selected ? prices[selected] : undefined} />
          <TradeBar selectedTicker={selected} lastPrice={lastPrice} onTrade={handleTrade} />
          <div className="grid min-h-0 grid-cols-1 gap-1 md:grid-cols-2 max-lg:auto-rows-[260px]">
            <Heatmap positions={live?.positions ?? []} onSelect={setSelected} />
            <PnlChart snapshots={snapshots} liveTotal={live?.total_value ?? null} />
          </div>
          <PositionsTable positions={live?.positions ?? []} onSelect={setSelected} />
        </div>

        <div className="min-h-0 max-lg:h-[520px]">
          <ChatPanel
            messages={messages}
            loading={chatLoading}
            onSend={(t) => void handleSend(t)}
            collapsed={chatCollapsed}
            onToggle={() => setChatCollapsed((c) => !c)}
          />
        </div>
      </main>
    </div>
  );
}
