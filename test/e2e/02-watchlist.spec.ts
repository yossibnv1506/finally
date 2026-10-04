import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

async function apiTickers(request: import("@playwright/test").APIRequestContext): Promise<string[]> {
  const wl = await (await request.get("/api/watchlist")).json();
  return wl.tickers.map((t: { ticker: string }) => t.ticker);
}

test.describe("watchlist", () => {
  test("add and remove a ticker", async ({ page, request }) => {
    await openApp(page);

    await page.getByTestId("watchlist-add-input").fill("pypl");
    await page.getByTestId("watchlist-add-button").click();

    await expect(page.getByTestId("watchlist-row-PYPL")).toBeVisible();
    // A newly added, non-seed ticker gets streamed prices too.
    await expect(page.getByTestId("watchlist-price-PYPL")).toHaveText(/\d+\.\d{2}/, { timeout: 15_000 });
    expect(await apiTickers(request)).toContain("PYPL");

    // Persisted: survives a reload.
    await page.reload();
    await expect(page.getByTestId("watchlist-row-PYPL")).toBeVisible();

    await page.getByTestId("watchlist-remove-PYPL").click();
    await expect(page.getByTestId("watchlist-row-PYPL")).toHaveCount(0);
    expect(await apiTickers(request)).not.toContain("PYPL");

    await page.reload();
    await expect(page.getByTestId("watchlist-row-AAPL")).toBeVisible();
    await expect(page.getByTestId("watchlist-row-PYPL")).toHaveCount(0);
  });

  test("rejects a duplicate ticker with an error", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("watchlist-add-input").fill("AAPL");
    await page.getByTestId("watchlist-add-button").click();
    await expect(page.getByTestId("watchlist-error")).toBeVisible();
    await expect(page.getByTestId("watchlist").getByTestId("watchlist-row-AAPL")).toHaveCount(1);
  });
});
