import { describe, expect, it } from "vitest";
import { formatPercent, formatSignedUsd, formatUsd, tone } from "@/lib/format";
import { pnlColor, revaluePortfolio, sessionChangePercent, squarify } from "@/lib/portfolio";
import { appendHistory } from "@/hooks/usePriceStream";
import { toChartData } from "@/components/TimeSeriesChart";
import { snapshotsToPoints } from "@/components/PnlChart";
import type { Portfolio } from "@/lib/types";
import { tick } from "./mocks";

const portfolio: Portfolio = {
  cash: 5000,
  total_value: 7000,
  positions_value: 2000,
  unrealized_pnl: 0,
  unrealized_pnl_percent: 0,
  positions: [
    { ticker: "AAPL", quantity: 10, avg_cost: 100, current_price: 100, market_value: 1000, unrealized_pnl: 0, unrealized_pnl_percent: 0, weight: 0.5 },
    { ticker: "TSLA", quantity: 5, avg_cost: 200, current_price: 200, market_value: 1000, unrealized_pnl: 0, unrealized_pnl_percent: 0, weight: 0.5 },
  ],
};

describe("revaluePortfolio", () => {
  it("re-prices positions from live ticks and recomputes totals", () => {
    const live = revaluePortfolio(portfolio, {
      AAPL: tick("AAPL", 110, 100, 1),
      TSLA: tick("TSLA", 180, 200, 1),
    });
    const aapl = live.positions.find((p) => p.ticker === "AAPL")!;
    const tsla = live.positions.find((p) => p.ticker === "TSLA")!;
    expect(aapl.market_value).toBeCloseTo(1100);
    expect(aapl.unrealized_pnl).toBeCloseTo(100);
    expect(aapl.unrealized_pnl_percent).toBeCloseTo(10);
    expect(tsla.unrealized_pnl).toBeCloseTo(-100);
    expect(tsla.unrealized_pnl_percent).toBeCloseTo(-10);
    expect(live.positions_value).toBeCloseTo(2000);
    expect(live.total_value).toBeCloseTo(7000);
    expect(live.unrealized_pnl).toBeCloseTo(0);
    expect(aapl.weight + tsla.weight).toBeCloseTo(1);
    expect(aapl.weight).toBeCloseTo(0.55);
  });

  it("falls back to the REST current_price when no tick exists", () => {
    const live = revaluePortfolio(portfolio, {});
    expect(live.total_value).toBeCloseTo(7000);
    expect(live.unrealized_pnl_percent).toBe(0);
  });

  it("handles an empty portfolio", () => {
    const live = revaluePortfolio({ ...portfolio, positions: [], cash: 10000 }, {});
    expect(live.total_value).toBe(10000);
    expect(live.positions_value).toBe(0);
  });
});

describe("squarify", () => {
  it("lays out tiles with areas proportional to value inside the bounds", () => {
    const rects = squarify(
      [
        { key: "A", value: 6 },
        { key: "B", value: 3 },
        { key: "C", value: 1 },
      ],
      100,
      100,
    );
    expect(rects).toHaveLength(3);
    const total = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(total).toBeCloseTo(10000);
    const a = rects.find((r) => r.key === "A")!;
    expect(a.w * a.h).toBeCloseTo(6000);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(100 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(100 + 1e-6);
    }
  });

  it("ignores zero values and empty input", () => {
    expect(squarify([], 100, 100)).toEqual([]);
    expect(squarify([{ key: "A", value: 0 }], 100, 100)).toEqual([]);
  });
});

describe("pnlColor", () => {
  it("is green for profit, red for loss, neutral for flat", () => {
    expect(pnlColor(3)).toMatch(/^rgba\(38, 166, 104/);
    expect(pnlColor(-3)).toMatch(/^rgba\(219, 68, 75/);
    expect(pnlColor(0)).toBe("rgb(52, 61, 74)");
  });
});

describe("formatting", () => {
  it("formats money and percents with signs", () => {
    expect(formatUsd(10000)).toBe("$10,000.00");
    expect(formatUsd(null)).toBe("—");
    expect(formatSignedUsd(12.5)).toBe("+$12.50");
    expect(formatSignedUsd(-12.5)).toBe("−$12.50");
    expect(formatPercent(1.234)).toBe("+1.23%");
    expect(formatPercent(-0.5)).toBe("−0.50%");
    expect(tone(0)).toBe("flat");
    expect(tone(-1)).toBe("down");
  });
});

describe("price history", () => {
  it("accumulates new ticks and skips re-sent unchanged ones", () => {
    let h = appendHistory({}, { AAPL: tick("AAPL", 100, 100, 1) });
    h = appendHistory(h, { AAPL: tick("AAPL", 101, 100, 2), MSFT: tick("MSFT", 50, 50, 2) });
    const same = appendHistory(h, { AAPL: tick("AAPL", 101, 100, 2) });
    expect(same).toBe(h);
    expect(h.AAPL.map((p) => p.price)).toEqual([100, 101]);
    expect(h.MSFT).toHaveLength(1);
    expect(sessionChangePercent(h.AAPL)).toBeCloseTo(1);
    expect(sessionChangePercent(undefined)).toBeNull();
  });

  it("caps history length", () => {
    let h = {};
    for (let i = 0; i < 20; i++) h = appendHistory(h, { X: tick("X", i + 1, i + 1, i) }, 5);
    expect((h as Record<string, unknown[]>).X).toHaveLength(5);
  });
});

describe("chart data", () => {
  it("dedupes to one sorted point per second", () => {
    const d = toChartData([
      { time: 10.2, value: 1 },
      { time: 10.7, value: 2 },
      { time: 9.1, value: 0 },
    ]);
    expect(d).toEqual([
      { time: 9, value: 0 },
      { time: 10, value: 2 },
    ]);
  });

  it("converts snapshots and appends the live total", () => {
    const pts = snapshotsToPoints(
      [
        { total_value: 10000, recorded_at: "2026-01-01T00:00:00Z" },
        { total_value: 10100, recorded_at: "2026-01-01T00:00:30Z" },
      ],
      10200,
      Date.parse("2026-01-01T00:01:00Z") / 1000,
    );
    expect(pts.map((p) => p.value)).toEqual([10000, 10100, 10200]);
    expect(snapshotsToPoints([], 10000)).toEqual([]);
  });
});
