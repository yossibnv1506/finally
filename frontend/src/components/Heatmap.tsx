import Panel from "./Panel";
import { formatPercent, formatUsd } from "@/lib/format";
import { pnlColor, squarify } from "@/lib/portfolio";
import type { Position } from "@/lib/types";

interface HeatmapProps {
  positions: Position[];
  onSelect?: (ticker: string) => void;
}

/** Treemap: tile area = portfolio weight, tile colour = unrealized P&L %. */
export default function Heatmap({ positions, onSelect }: HeatmapProps) {
  const rects = squarify(
    positions.map((p) => ({ key: p.ticker, value: p.market_value })),
    100,
    100,
  );
  const byTicker = new Map(positions.map((p) => [p.ticker, p]));
  return (
    <Panel testId="portfolio-heatmap" title="Holdings by weight" className="h-full" bodyClassName="p-1">
      {rects.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-xs text-dim">
          Buy a position to see it mapped here by size and P&amp;L.
        </div>
      ) : (
        <div className="relative h-full w-full">
          {rects.map((r) => {
            const p = byTicker.get(r.key)!;
            const small = r.w < 14 || r.h < 14;
            return (
              <button
                type="button"
                key={r.key}
                data-testid={`heatmap-tile-${r.key}`}
                data-pnl={p.unrealized_pnl >= 0 ? "profit" : "loss"}
                title={`${p.ticker}: ${formatUsd(p.market_value)} (${(p.weight * 100).toFixed(1)}%), P&L ${formatPercent(p.unrealized_pnl_percent)}`}
                onClick={() => onSelect?.(p.ticker)}
                className="absolute flex flex-col items-start justify-start overflow-hidden border border-ink p-1.5 text-left text-white transition-[filter] hover:brightness-125"
                style={{
                  left: `${r.x}%`,
                  top: `${r.y}%`,
                  width: `${r.w}%`,
                  height: `${r.h}%`,
                  backgroundColor: pnlColor(p.unrealized_pnl_percent),
                }}
              >
                <span className={`block font-semibold leading-tight ${small ? "text-[10px]" : "text-[13px]"}`}>
                  {p.ticker}
                </span>
                {!small ? (
                  <span className="num block text-[11px] leading-tight opacity-90">
                    {formatPercent(p.unrealized_pnl_percent)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
