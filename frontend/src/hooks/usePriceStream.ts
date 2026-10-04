"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnectionStatus, PriceMap, PricePoint, PriceUpdate } from "@/lib/types";

export const MAX_HISTORY_POINTS = 600;
const RECONNECT_DELAY_MS = 2000;

export interface PriceStreamState {
  prices: PriceMap;
  history: Record<string, PricePoint[]>;
  status: ConnectionStatus;
}

/** Merge one SSE payload into the accumulated per-ticker history (pure; exported for tests). */
export function appendHistory(
  history: Record<string, PricePoint[]>,
  payload: PriceMap,
  max = MAX_HISTORY_POINTS,
): Record<string, PricePoint[]> {
  let next = history;
  for (const [ticker, u] of Object.entries(payload)) {
    if (!u || typeof u.price !== "number") continue;
    const series = history[ticker] ?? [];
    const last = series[series.length - 1];
    if (last && last.time === u.timestamp) continue; // unchanged tick re-sent
    const appended = [...series, { time: u.timestamp, price: u.price }];
    if (appended.length > max) appended.splice(0, appended.length - max);
    if (next === history) next = { ...history };
    next[ticker] = appended;
  }
  return next;
}

/**
 * Subscribes to /api/stream/prices with EventSource. EventSource retries on its own;
 * if the browser gives up (readyState CLOSED) we open a fresh connection after a delay.
 */
export function usePriceStream(url = "/api/stream/prices"): PriceStreamState {
  const [prices, setPrices] = useState<PriceMap>({});
  const [history, setHistory] = useState<Record<string, PricePoint[]>>({});
  const [status, setStatus] = useState<ConnectionStatus>("reconnecting");
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      setStatus("disconnected");
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      const es = new EventSource(url);
      sourceRef.current = es;

      es.onopen = () => {
        if (!disposed) setStatus("connected");
      };
      es.onmessage = (event: MessageEvent) => {
        if (disposed) return;
        let payload: PriceMap;
        try {
          payload = JSON.parse(event.data) as PriceMap;
        } catch {
          return;
        }
        if (!payload || typeof payload !== "object") return;
        setStatus("connected");
        setPrices((prev) => {
          const next: PriceMap = { ...prev };
          for (const [t, u] of Object.entries(payload)) next[t] = u as PriceUpdate;
          return next;
        });
        setHistory((prev) => appendHistory(prev, payload));
      };
      es.onerror = () => {
        if (disposed) return;
        if (es.readyState === EventSource.CLOSED) {
          setStatus("disconnected");
          es.close();
          timer = setTimeout(connect, RECONNECT_DELAY_MS);
        } else {
          setStatus("reconnecting");
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [url]);

  return { prices, history, status };
}
