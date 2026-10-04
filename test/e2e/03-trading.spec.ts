import { expect, test } from "@playwright/test";
import { apiPortfolio, openApp, placeTrade, readCash } from "./helpers";

test.describe("trading", () => {
  test("buy shares: cash decreases, position appears, portfolio updates", async ({ page, request }) => {
    await openApp(page);
    const cashBefore = await readCash(page);
    expect(cashBefore).toBeGreaterThan(0);

    await placeTrade(page, "NVDA", "3", "buy");

    await expect(page.getByTestId("position-row-NVDA")).toBeVisible();
    await expect(page.getByTestId("position-qty-NVDA")).toHaveText(/^3(\.0+)?$/);
    await expect.poll(() => readCash(page)).toBeLessThan(cashBefore);
    await expect(page.getByTestId("trade-error")).toHaveCount(0);

    const pf = await apiPortfolio(request);
    const pos = pf.positions.find((p: { ticker: string }) => p.ticker === "NVDA");
    expect(pos).toBeTruthy();
    expect(pos.quantity).toBeCloseTo(3);
    expect(pf.cash).toBeCloseTo(cashBefore - 3 * pos.avg_cost, 1);
  });

  test("sell part of a position: quantity drops, cash increases", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("position-row-NVDA")).toBeVisible();
    const cashBefore = await readCash(page);

    await placeTrade(page, "NVDA", "1", "sell");

    await expect(page.getByTestId("position-qty-NVDA")).toHaveText(/^2(\.0+)?$/);
    await expect.poll(() => readCash(page)).toBeGreaterThan(cashBefore);
  });

  test("sell the rest: position disappears", async ({ page, request }) => {
    await openApp(page);
    await expect(page.getByTestId("position-row-NVDA")).toBeVisible();
    const cashBefore = await readCash(page);

    await placeTrade(page, "NVDA", "2", "sell");

    await expect(page.getByTestId("position-row-NVDA")).toHaveCount(0);
    await expect.poll(() => readCash(page)).toBeGreaterThan(cashBefore);
    const pf = await apiPortfolio(request);
    expect(pf.positions.find((p: { ticker: string }) => p.ticker === "NVDA")).toBeUndefined();
  });

  test("selling more than owned shows an error and changes nothing", async ({ page }) => {
    await openApp(page);
    const cashBefore = await readCash(page);
    await placeTrade(page, "JPM", "5", "sell");
    await expect(page.getByTestId("trade-error")).toBeVisible();
    await expect(page.getByTestId("position-row-JPM")).toHaveCount(0);
    expect(await readCash(page)).toBeCloseTo(cashBefore, 2);
  });

  test("buying with insufficient cash shows an error", async ({ page }) => {
    await openApp(page);
    await placeTrade(page, "AAPL", "1000000", "buy");
    await expect(page.getByTestId("trade-error")).toBeVisible();
    await expect(page.getByTestId("trade-error")).toContainText(/cash/i);
  });
});
