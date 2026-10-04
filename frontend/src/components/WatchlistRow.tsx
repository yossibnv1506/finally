"use client";

import { useEffect, useRef, useState } from "react";
import Sparkline from "./Sparkline";
import { formatPercent, formatPrice, tone } from "@/lib/format";
import type { PricePoint } from "@/lib/types";

// How long the flash class is held; removing it triggers the 500ms CSS fade-out.
export const FLASH_MS = 250;

interface WatchlistRowProps {
  ticker: string;
  price: number | null;
  changePercent: number | null;
  history: PricePoint[] | undefined;
  selected: boolean;
  onSelect: (ticker: string) => void;
  onRemove: (ticker: string) => void;
}

/** Hook: returns "up" | "down" briefly after `price` changes, then null. */
export function usePriceFlash(price: number | null): "up" | "down" | null {
  const prev = useRef<number | null>(price);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = price;
    if (before == null || price == null || before === price) return;
    setFlash(price > before ? "up" : "down");
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [price]);

  return flash;
}

const TONE_TEXT = { up: "text-up", down: "text-down", flat: "text-dim" } as const;

export default function WatchlistRow({
  ticker,
  price,
  changePercent,
  history,
  selected,
  onSelect,
  onRemove,
}: WatchlistRowProps) {
  const flash = usePriceFlash(price);
  return (
    <li
      data-testid={`watchlist-row-${ticker}`}
      data-selected={selected || undefined}
      className={`group relative grid cursor-pointer grid-cols-[3.25rem_minmax(0,1fr)_4.25rem_3.5rem_1.25rem] items-center gap-2 border-b border-rule/60 py-1.5 pl-3 pr-1.5 text-[13px] hover:bg-raise ${
        selected ? "bg-raise" : ""
      }`}
      onClick={() => onSelect(ticker)}
    >
      {selected ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" /> : null}
      <button
        type="button"
        className="truncate text-left font-semibold text-text focus-visible:outline-offset-2"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(ticker);
        }}
        aria-pressed={selected}
      >
        {ticker}
      </button>
      <Sparkline points={history} />
      <span
        data-testid={`watchlist-price-${ticker}`}
        data-flash={flash ?? undefined}
        className={`num flashable rounded-sm px-1 text-right text-text ${flash ? `flash-${flash}` : ""}`}
      >
        {formatPrice(price)}
      </span>
      <span className={`num text-right text-xs ${TONE_TEXT[tone(changePercent)]}`}>{formatPercent(changePercent)}</span>
      <button
        type="button"
        data-testid={`watchlist-remove-${ticker}`}
        aria-label={`Remove ${ticker} from watchlist`}
        title={`Remove ${ticker}`}
        className="flex h-5 w-5 items-center justify-center rounded-sm text-faint opacity-50 hover:bg-rule hover:text-down hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(ticker);
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
    </li>
  );
}
