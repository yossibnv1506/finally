"use client";

import { useEffect, useState } from "react";
import { formatPrice, formatQty } from "@/lib/format";
import type { TradeSide } from "@/lib/types";

interface TradeBarProps {
  selectedTicker: string | null;
  lastPrice: (ticker: string) => number | null;
  onTrade: (ticker: string, quantity: number, side: TradeSide) => Promise<{ price: number; quantity: number }>;
}

/** Order ticket: market orders, instant fill, no confirmation. */
export default function TradeBar({ selectedTicker, lastPrice, onTrade }: TradeBarProps) {
  const [ticker, setTicker] = useState(selectedTicker ?? "");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<TradeSide | null>(null);

  useEffect(() => {
    if (selectedTicker) setTicker(selectedTicker);
  }, [selectedTicker]);

  const symbol = ticker.trim().toUpperCase();
  const quantity = Number(qty);
  const price = symbol ? lastPrice(symbol) : null;
  const estimate = price != null && quantity > 0 ? price * quantity : null;

  const submit = async (side: TradeSide) => {
    setNotice(null);
    if (!symbol) {
      setError("Enter a ticker symbol.");
      return;
    }
    if (!qty.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      setError("Enter a quantity greater than 0.");
      return;
    }
    setError(null);
    setBusy(side);
    try {
      const filled = await onTrade(symbol, quantity, side);
      setNotice(`${side === "buy" ? "Bought" : "Sold"} ${formatQty(filled.quantity)} ${symbol} at ${formatPrice(filled.price)}`);
      setQty("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The order didn't go through.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      aria-label="Order ticket"
      className="flex flex-wrap items-center gap-2 border border-rule bg-panel px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit("buy");
      }}
    >
      <span className="mr-1 text-[13px] font-medium">Market order</span>
      <input
        data-testid="trade-ticker-input"
        aria-label="Ticker"
        value={ticker}
        onChange={(e) => {
          setTicker(e.target.value.toUpperCase());
          setError(null);
        }}
        placeholder="Ticker"
        maxLength={10}
        autoComplete="off"
        spellCheck={false}
        className="w-24 rounded-sm border border-rule bg-ink px-2 py-1 text-[13px] uppercase placeholder:normal-case placeholder:text-faint focus:border-blue focus:outline-none"
      />
      <input
        data-testid="trade-quantity-input"
        aria-label="Quantity"
        value={qty}
        onChange={(e) => {
          setQty(e.target.value);
          setError(null);
        }}
        placeholder="Shares"
        inputMode="decimal"
        type="number"
        min="0"
        step="any"
        className="num w-24 rounded-sm border border-rule bg-ink px-2 py-1 text-[13px] placeholder:text-faint focus:border-blue focus:outline-none"
      />
      <button
        type="button"
        data-testid="trade-buy-button"
        disabled={busy !== null}
        onClick={() => void submit("buy")}
        className="rounded-sm bg-purple px-4 py-1 text-[13px] font-semibold text-white hover:bg-purple-hi disabled:opacity-50"
      >
        {busy === "buy" ? "Buying…" : "Buy"}
      </button>
      <button
        type="button"
        data-testid="trade-sell-button"
        disabled={busy !== null}
        onClick={() => void submit("sell")}
        className="rounded-sm border border-purple px-4 py-1 text-[13px] font-semibold text-text hover:bg-purple/30 disabled:opacity-50"
      >
        {busy === "sell" ? "Selling…" : "Sell"}
      </button>
      <span className="num ml-1 text-xs text-dim">
        {estimate != null ? `≈ ${formatPrice(estimate)} at ${formatPrice(price)}` : price != null ? `Last ${formatPrice(price)}` : ""}
      </span>
      <span className="ml-auto text-xs" aria-live="polite">
        {error ? (
          <span data-testid="trade-error" role="alert" className="text-down">
            {error}
          </span>
        ) : notice ? (
          <span data-testid="trade-confirmation" className="text-up">
            {notice}
          </span>
        ) : null}
      </span>
    </form>
  );
}
