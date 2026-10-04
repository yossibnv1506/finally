import { formatPercent, formatSignedUsd, formatUsd, tone } from "@/lib/format";
import type { ConnectionStatus } from "@/lib/types";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Live",
  reconnecting: "Reconnecting",
  disconnected: "Offline",
};

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected: "bg-up",
  reconnecting: "bg-accent status-pulse",
  disconnected: "bg-down",
};

const TONE_TEXT = { up: "text-up", down: "text-down", flat: "text-dim" } as const;

interface HeaderProps {
  totalValue: number | null;
  cash: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
  status: ConnectionStatus;
}

export default function Header({ totalValue, cash, unrealizedPnl, unrealizedPnlPercent, status }: HeaderProps) {
  const pnlTone = TONE_TEXT[tone(unrealizedPnl)];
  return (
    <header className="flex flex-wrap items-stretch gap-x-8 gap-y-2 border-b border-rule bg-panel px-4 py-2">
      <div className="flex items-center gap-2 pr-2">
        <span aria-hidden className="block h-5 w-1.5 bg-accent" />
        <span className="text-lg font-semibold tracking-tight text-text">
          Fin<span className="text-accent">Ally</span>
        </span>
      </div>

      <div className="flex flex-col justify-center">
        <span className="text-[11px] text-dim">Portfolio value</span>
        <span data-testid="header-total-value" className="num text-2xl font-semibold leading-tight text-text">
          {formatUsd(totalValue)}
        </span>
      </div>

      <div className="flex flex-col justify-center">
        <span className="text-[11px] text-dim">Unrealized P&amp;L</span>
        <span className={`num text-base font-medium leading-tight ${pnlTone}`}>
          {formatSignedUsd(unrealizedPnl)}{" "}
          <span className="text-xs">{formatPercent(unrealizedPnlPercent)}</span>
        </span>
      </div>

      <div className="flex flex-col justify-center">
        <span className="text-[11px] text-dim">Cash</span>
        <span data-testid="header-cash" className="num text-base font-medium leading-tight text-text">
          {formatUsd(cash)}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2 text-xs text-dim">
        <span
          data-testid="connection-status"
          data-status={status}
          role="status"
          aria-label={`Price stream ${STATUS_LABEL[status].toLowerCase()}`}
          title={`Price stream: ${STATUS_LABEL[status]}`}
          className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_COLOR[status]}`}
        />
        <span>{STATUS_LABEL[status]}</span>
      </div>
    </header>
  );
}
