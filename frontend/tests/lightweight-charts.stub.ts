import { vi } from "vitest";

export const series = { setData: vi.fn(), applyOptions: vi.fn() };
export const chart = {
  addSeries: vi.fn(() => series),
  timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
  remove: vi.fn(),
  applyOptions: vi.fn(),
};
export const createChart = vi.fn(() => chart);
export const AreaSeries = "Area";
export const ColorType = { Solid: "solid" };
export const LineType = { Simple: 0 };
export const CrosshairMode = { Magnet: 1 };
