"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";

export interface SeriesPoint {
  time: number; // unix seconds (may be fractional)
  value: number;
}

/** Lightweight Charts needs strictly increasing integer-second times: keep the last value per second. */
export function toChartData(points: SeriesPoint[]): { time: UTCTimestamp; value: number }[] {
  const bySecond = new Map<number, number>();
  for (const p of points) {
    if (!Number.isFinite(p.time) || !Number.isFinite(p.value)) continue;
    bySecond.set(Math.floor(p.time), p.value);
  }
  return [...bySecond.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
}

const timeLabel = (t: unknown, withSeconds: boolean) => {
  const d = new Date(Number(t) * 1000);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
};

interface TimeSeriesChartProps {
  points: SeriesPoint[];
  color: string;
  emptyMessage: string;
  className?: string;
}

/** Canvas area chart (TradingView Lightweight Charts), loaded client-side only. */
export default function TimeSeriesChart({ points, color, emptyMessage, className = "" }: TimeSeriesChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const data = toChartData(points);
  const latest = useRef(data);
  latest.current = data;
  const colorRef = useRef(color);
  colorRef.current = color;

  useEffect(() => {
    let cancelled = false;
    let chart: IChartApi | null = null;
    import("lightweight-charts")
      .then(({ createChart, AreaSeries, ColorType, LineType, CrosshairMode }) => {
        if (cancelled || !host.current) return;
        chart = createChart(host.current, {
          autoSize: true,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: "#7e8a9a",
            fontFamily: "IBM Plex Sans Condensed, Arial Narrow, sans-serif",
            fontSize: 11,
            attributionLogo: false,
          },
          grid: {
            vertLines: { color: "rgba(35, 45, 58, 0.6)" },
            horzLines: { color: "rgba(35, 45, 58, 0.6)" },
          },
          rightPriceScale: { borderColor: "#232d3a", scaleMargins: { top: 0.15, bottom: 0.08 } },
          timeScale: {
            borderColor: "#232d3a",
            timeVisible: true,
            secondsVisible: true,
            tickMarkFormatter: (t: unknown) => timeLabel(t, true),
          },
          localization: { timeFormatter: (t: unknown) => timeLabel(t, true) },
          crosshair: { mode: CrosshairMode.Magnet },
          handleScale: false,
          handleScroll: false,
        });
        const c = colorRef.current;
        const series = chart.addSeries(AreaSeries, {
          lineColor: c,
          lineWidth: 2,
          lineType: LineType.Simple,
          topColor: `${c}55`,
          bottomColor: `${c}05`,
          priceLineVisible: true,
          lastValueVisible: true,
        });
        chartRef.current = chart;
        seriesRef.current = series;
        series.setData(latest.current);
        chart.timeScale().fitContent();
      })
      .catch(() => {
        /* chart library unavailable (e.g. no canvas): the empty state still renders */
      });
    return () => {
      cancelled = true;
      chart?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    seriesRef.current?.applyOptions({ lineColor: color, topColor: `${color}55`, bottomColor: `${color}05` });
  }, [color]);

  const last = data[data.length - 1];
  const signature = last ? `${data.length}:${data[0].time}:${last.time}:${last.value}` : "";
  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(latest.current);
    chartRef.current?.timeScale().fitContent();
  }, [signature]);

  return (
    <div className={`relative h-full w-full ${className}`} data-points={data.length}>
      <div ref={host} className="absolute inset-0" />
      {data.length < 2 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-dim">
          {emptyMessage}
        </div>
      ) : null}
    </div>
  );
}
