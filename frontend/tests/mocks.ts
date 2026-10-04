import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { PriceMap, PriceUpdate } from "@/lib/types";

/** Minimal controllable EventSource for tests. */
export class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: MockEventSource[] = [];
  static reset() {
    MockEventSource.instances = [];
  }
  static get latest(): MockEventSource {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }

  url: string;
  readyState = MockEventSource.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }
  open() {
    act(() => {
      this.readyState = MockEventSource.OPEN;
      this.onopen?.(new Event("open"));
    });
  }
  emit(payload: PriceMap) {
    act(() => {
      this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
    });
  }
  fail(readyState: number) {
    act(() => {
      this.readyState = readyState;
      this.onerror?.(new Event("error"));
    });
  }
}

export function tick(ticker: string, price: number, previous: number, timestamp: number): PriceUpdate {
  return {
    ticker,
    price,
    previous_price: previous,
    timestamp,
    change: price - previous,
    change_percent: ((price - previous) / previous) * 100,
    direction: price > previous ? "up" : price < previous ? "down" : "flat",
  };
}

type Handler = (init: RequestInit | undefined, url: string) => { status?: number; body: unknown };

/** Install a fetch mock routing "METHOD /path" keys to handlers; returns the spy. */
export function mockFetch(routes: Record<string, Handler | unknown>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url}`;
    const route = key in routes ? routes[key] : undefined;
    if (route === undefined) {
      return new Response(JSON.stringify({ detail: `no mock for ${key}` }), { status: 404 });
    }
    const result = typeof route === "function" ? (route as Handler)(init, url) : { body: route };
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
