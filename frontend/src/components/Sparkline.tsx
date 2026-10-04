import type { PricePoint } from "@/lib/types";

interface SparklineProps {
  points: PricePoint[] | undefined;
  width?: number;
  height?: number;
}

/** Inline SVG sparkline of prices accumulated from the stream since page load. */
export default function Sparkline({ points, width = 72, height = 22 }: SparklineProps) {
  if (!points || points.length < 2) {
    return <svg width="100%" height={height} aria-hidden className="block" />;
  }
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = prices
    .map((p, i) => `${(i * step).toFixed(1)},${(height - 1 - ((p - min) / span) * (height - 2)).toFixed(1)}`)
    .join(" ");
  const up = prices[prices.length - 1] >= prices[0];
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden className="block max-w-24" data-testid="sparkline">
      <polyline
        points={d}
        fill="none"
        stroke={up ? "var(--color-up)" : "var(--color-down)"}
        strokeWidth={1.25}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
