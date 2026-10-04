import Panel from "./Panel";
import TimeSeriesChart, { type SeriesPoint } from "./TimeSeriesChart";
import { formatSignedUsd, tone } from "@/lib/format";
import type { Snapshot } from "@/lib/types";

interface PnlChartProps {
  snapshots: Snapshot[];
  liveTotal: number | null;
  nowSeconds?: number;
}

/** Snapshots from the DB plus the live total as a trailing point, so the line moves between snapshots. */
export function snapshotsToPoints(snapshots: Snapshot[], liveTotal: number | null, nowSeconds?: number): SeriesPoint[] {
  const pts: SeriesPoint[] = snapshots
    .map((s) => ({ time: Date.parse(s.recorded_at) / 1000, value: s.total_value }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value));
  if (liveTotal != null && pts.length > 0) {
    const now = nowSeconds ?? Date.now() / 1000;
    if (now > pts[pts.length - 1].time) pts.push({ time: now, value: liveTotal });
  }
  return pts;
}

export default function PnlChart({ snapshots, liveTotal, nowSeconds }: PnlChartProps) {
  const points = snapshotsToPoints(snapshots, liveTotal, nowSeconds);
  const first = points[0]?.value;
  const last = points[points.length - 1]?.value;
  const delta = first != null && last != null ? last - first : null;
  const t = tone(delta);
  return (
    <Panel
      testId="pnl-chart"
      title="Portfolio value"
      aside={
        delta != null ? (
          <span className={`num ${t === "up" ? "text-up" : t === "down" ? "text-down" : "text-dim"}`}>
            {formatSignedUsd(delta)}
          </span>
        ) : null
      }
      className="h-full"
      bodyClassName="p-1"
    >
      <div data-testid="pnl-chart-points" data-count={snapshots.length} className="h-full">
        <TimeSeriesChart
          points={points}
          color={t === "down" ? "#e0474f" : "#26a668"}
          emptyMessage="Value history appears after the first snapshot."
        />
      </div>
    </Panel>
  );
}
