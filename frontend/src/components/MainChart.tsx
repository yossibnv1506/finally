import Panel from "./Panel";
import TimeSeriesChart from "./TimeSeriesChart";
import { formatPercent, formatPrice, tone } from "@/lib/format";
import { sessionChangePercent } from "@/lib/portfolio";
import type { PricePoint, PriceUpdate } from "@/lib/types";

interface MainChartProps {
  ticker: string | null;
  history: PricePoint[] | undefined;
  latest: PriceUpdate | undefined;
}

const TONE_TEXT = { up: "text-up", down: "text-down", flat: "text-dim" } as const;

export default function MainChart({ ticker, history, latest }: MainChartProps) {
  const change = sessionChangePercent(history);
  const t = tone(change);
  const color = t === "down" ? "#e0474f" : "#209dd7";
  return (
    <Panel
      testId="main-chart"
      title={
        <span className="flex items-baseline gap-3">
          <span data-testid="main-chart-ticker" className="text-[15px] font-semibold text-accent">
            {ticker ?? "No ticker"}
          </span>
          {latest ? (
            <>
              <span className="num text-[15px] text-text">{formatPrice(latest.price)}</span>
              <span className={`num text-xs ${TONE_TEXT[t]}`}>{formatPercent(change)} this session</span>
            </>
          ) : null}
        </span>
      }
      className="h-full"
      bodyClassName="p-1"
    >
      <TimeSeriesChart
        key={ticker ?? "none"}
        points={(history ?? []).map((p) => ({ time: p.time, value: p.price }))}
        color={color}
        emptyMessage={ticker ? `Collecting ${ticker} prices…` : "Select a ticker from the watchlist."}
      />
    </Panel>
  );
}
