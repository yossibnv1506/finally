import { expect, test } from "@playwright/test";
import { openApp, placeTrade } from "./helpers";

function rgb(color: string): [number, number, number] {
  const m = color.match(/\d+(\.\d+)?/g) ?? [];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

test.describe("portfolio visualisation", () => {
  test("heatmap tiles render with P&L colours and the P&L chart has data", async ({ page }) => {
    await openApp(page);

    for (const [t, q] of [["MSFT", "2"], ["TSLA", "4"]] as const) {
      await placeTrade(page, t, q, "buy");
      await expect(page.getByTestId(`position-row-${t}`)).toBeVisible();
    }

    const heatmap = page.getByTestId("portfolio-heatmap");
    await expect(heatmap).toBeVisible();
    for (const t of ["MSFT", "TSLA"]) {
      const tile = page.getByTestId(`heatmap-tile-${t}`);
      await expect(tile).toBeVisible();
      const box = await tile.boundingBox();
      expect(box && box.width > 0 && box.height > 0).toBeTruthy();

      // Read the P&L flag and the colour in one browser call so a tick can't land in between.
      const { pnl, bg } = await tile.evaluate((el) => ({
        pnl: el.getAttribute("data-pnl"),
        bg: getComputedStyle(el).backgroundColor,
      }));
      expect(["profit", "loss"]).toContain(pnl);
      const [r, g, b] = rgb(bg);
      // Right after a buy the P&L is ~0; the heatmap paints |P&L%| < 0.005 a neutral grey
      // (pnlColor in frontend/src/lib/portfolio.ts) whatever the sign, so accept that.
      const flat = r === 52 && g === 61 && b === 74;
      if (flat) continue;
      if (pnl === "profit") expect(g).toBeGreaterThanOrEqual(r);
      else expect(r).toBeGreaterThan(g);
    }

    // One tile per position.
    await expect(heatmap.locator('[data-testid^="heatmap-tile-"]')).toHaveCount(
      await page.locator('[data-testid^="position-row-"]').count(),
    );

    const pnlChart = page.getByTestId("pnl-chart");
    await expect(pnlChart).toBeVisible();
    // Startup snapshot + one per trade => several points.
    await expect
      .poll(async () => Number(await page.getByTestId("pnl-chart-points").getAttribute("data-count")))
      .toBeGreaterThanOrEqual(2);
    await expect(pnlChart.locator("canvas").first()).toBeVisible();

    const hist = await (await page.request.get("/api/portfolio/history")).json();
    expect(hist.snapshots.length).toBeGreaterThanOrEqual(2);
  });
});
