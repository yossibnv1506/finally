"use client";

import { useState, type FormEvent } from "react";
import Panel from "./Panel";
import WatchlistRow from "./WatchlistRow";
import { sessionChangePercent } from "@/lib/portfolio";
import type { PriceMap, PricePoint, WatchlistItem } from "@/lib/types";

interface WatchlistProps {
  items: WatchlistItem[];
  prices: PriceMap;
  history: Record<string, PricePoint[]>;
  selected: string | null;
  onSelect: (ticker: string) => void;
  onAdd: (ticker: string) => Promise<void>;
  onRemove: (ticker: string) => Promise<void>;
}

const TICKER_RE = /^[A-Z.]{1,10}$/;

export default function Watchlist({ items, prices, history, selected, onSelect, onAdd, onRemove }: WatchlistProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ticker = draft.trim().toUpperCase();
    if (!ticker) return;
    if (!TICKER_RE.test(ticker)) {
      setError("Use 1–10 letters, e.g. PYPL or BRK.B.");
      return;
    }
    if (items.some((i) => i.ticker === ticker)) {
      setError(`${ticker} is already on your watchlist.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd(ticker);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that ticker.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ticker: string) => {
    setError(null);
    try {
      await onRemove(ticker);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that ticker.");
    }
  };

  return (
    <Panel
      testId="watchlist"
      title="Watchlist"
      aside={<span className="num">{items.length}</span>}
      className="h-full"
      bodyClassName="flex flex-col"
    >
      <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_4.25rem_3.5rem_1.25rem] gap-2 border-b border-rule py-1 pl-3 pr-1.5 text-[11px] text-faint">
        <span>Symbol</span>
        <span>Session</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg</span>
        <span />
      </div>
      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {items.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-dim">Add a ticker below to start watching it.</li>
        ) : (
          items.map((item) => {
            const live = prices[item.ticker];
            const series = history[item.ticker];
            return (
              <WatchlistRow
                key={item.ticker}
                ticker={item.ticker}
                price={live?.price ?? item.price}
                changePercent={sessionChangePercent(series) ?? item.change_percent}
                history={series}
                selected={selected === item.ticker}
                onSelect={onSelect}
                onRemove={remove}
              />
            );
          })
        )}
      </ul>
      <form onSubmit={submit} className="shrink-0 border-t border-rule p-2">
        <div className="flex gap-1.5">
          <input
            data-testid="watchlist-add-input"
            aria-label="Ticker to add"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value.toUpperCase());
              setError(null);
            }}
            placeholder="Add ticker"
            maxLength={10}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-sm border border-rule bg-ink px-2 py-1 text-[13px] uppercase text-text placeholder:normal-case placeholder:text-faint focus:border-blue focus:outline-none"
          />
          <button
            type="submit"
            data-testid="watchlist-add-button"
            disabled={busy}
            className="rounded-sm bg-purple px-3 py-1 text-[13px] font-medium text-white hover:bg-purple-hi disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {error ? (
          <p role="alert" data-testid="watchlist-error" className="mt-1.5 text-xs text-down">
            {error}
          </p>
        ) : null}
      </form>
    </Panel>
  );
}
