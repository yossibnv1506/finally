import { expect, test } from "@playwright/test";
import { DEFAULT_TICKERS, expectPriceToChange, openApp, parseUsd } from "./helpers";

// Must run first, against a freshly seeded database.
test.describe("fresh start", () => {
  test("health endpoint is up", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("shows the 10 default tickers, $10,000 and streaming prices", async ({ page }) => {
    await openApp(page);

    const watchlist = page.getByTestId("watchlist");
    await expect(watchlist).toBeVisible();
    for (const t of DEFAULT_TICKERS) {
      await expect(page.getByTestId(`watchlist-row-${t}`)).toBeVisible();
    }
    await expect(watchlist.locator('[data-testid^="watchlist-row-"]')).toHaveCount(10);

    await expect(page.getByTestId("header-cash")).toHaveText(/\$10,000\.00/);
    await expect.poll(async () => parseUsd(await page.getByTestId("header-total-value").textContent())).toBe(10000);

    // Prices arrive and keep changing (SSE stream is live).
    await expect(page.getByTestId("watchlist-price-AAPL")).toHaveText(/\d+\.\d{2}/);
    await expectPriceToChange(page, "AAPL");

    for (const id of ["main-chart", "portfolio-heatmap", "pnl-chart", "positions-table", "chat-panel"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test("clicking a watchlist ticker selects it in the main chart", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("watchlist-row-MSFT").click();
    await expect(page.getByTestId("main-chart-ticker")).toHaveText(/MSFT/);
    await expect(page.getByTestId("main-chart").locator("canvas").first()).toBeVisible();
  });
});
