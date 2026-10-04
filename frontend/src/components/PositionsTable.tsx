import Panel from "./Panel";
import { formatPercent, formatPrice, formatQty, formatSignedUsd, formatUsd, tone } from "@/lib/format";
import type { Position } from "@/lib/types";

interface PositionsTableProps {
  positions: Position[];
  onSelect?: (ticker: string) => void;
}

const TONE_TEXT = { up: "text-up", down: "text-down", flat: "text-dim" } as const;

export default function PositionsTable({ positions, onSelect }: PositionsTableProps) {
  return (
    <Panel
      title="Positions"
      aside={<span className="num">{positions.length}</span>}
      className="h-full"
      bodyClassName="scroll-thin overflow-auto"
    >
      <table data-testid="positions-table" className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 bg-panel text-[11px] text-faint">
          <tr className="border-b border-rule">
            <th className="px-3 py-1 text-left font-normal">Symbol</th>
            <th className="px-2 py-1 text-right font-normal">Qty</th>
            <th className="px-2 py-1 text-right font-normal">Avg cost</th>
            <th className="px-2 py-1 text-right font-normal">Last</th>
            <th className="px-2 py-1 text-right font-normal">Value</th>
            <th className="px-2 py-1 text-right font-normal">Unrealized P&amp;L</th>
            <th className="px-3 py-1 text-right font-normal">Return</th>
          </tr>
        </thead>
        <tbody>
          {positions.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-xs text-dim">
                No open positions. Use the order ticket or ask the assistant to buy.
              </td>
            </tr>
          ) : (
            positions.map((p) => {
              const t = TONE_TEXT[tone(p.unrealized_pnl)];
              return (
                <tr
                  key={p.ticker}
                  data-testid={`position-row-${p.ticker}`}
                  onClick={() => onSelect?.(p.ticker)}
                  className="cursor-pointer border-b border-rule/60 hover:bg-raise"
                >
                  <td className="px-3 py-1 font-semibold">{p.ticker}</td>
                  <td className="num px-2 py-1 text-right" data-testid={`position-qty-${p.ticker}`}>
                    {formatQty(p.quantity)}
                  </td>
                  <td className="num px-2 py-1 text-right text-dim">{formatPrice(p.avg_cost)}</td>
                  <td className="num px-2 py-1 text-right">{formatPrice(p.current_price)}</td>
                  <td className="num px-2 py-1 text-right">{formatUsd(p.market_value)}</td>
                  <td className={`num px-2 py-1 text-right ${t}`} data-testid={`position-pnl-${p.ticker}`}>
                    {formatSignedUsd(p.unrealized_pnl)}
                  </td>
                  <td className={`num px-3 py-1 text-right ${t}`}>{formatPercent(p.unrealized_pnl_percent)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </Panel>
  );
}
