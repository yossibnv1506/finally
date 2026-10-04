import { expect, test } from "@playwright/test";
import { apiPortfolio, openApp } from "./helpers";

// Requires the backend to run with LLM_MOCK=true.
test.describe("AI chat (mocked LLM)", () => {
  test("'buy 1 AAPL' gets a reply and an inline executed trade", async ({ page, request }) => {
    await openApp(page);
    const before = await apiPortfolio(request);
    const aaplBefore = before.positions.find((p: { ticker: string }) => p.ticker === "AAPL")?.quantity ?? 0;

    if ((await page.getByTestId("chat-panel").getAttribute("data-collapsed")) === "true") {
      await page.getByTestId("chat-toggle").click();
    }

    await page.getByTestId("chat-input").fill("buy 1 AAPL");
    await page.getByTestId("chat-send-button").click();

    await expect(page.locator('[data-testid="chat-message"][data-role="user"]').last()).toContainText("buy 1 AAPL");
    const reply = page.locator('[data-testid="chat-message"][data-role="assistant"]').last();
    await expect(reply).toContainText(/AAPL/);
    const action = reply.getByTestId("chat-action");
    await expect(action).toHaveCount(1);
    await expect(action).toHaveAttribute("data-status", "executed");
    await expect(action).toContainText(/AAPL/);
    await expect(page.getByTestId("chat-loading")).toHaveCount(0);

    // The trade really happened and the UI refreshed.
    await expect(page.getByTestId("position-row-AAPL")).toBeVisible();
    const after = await apiPortfolio(request);
    const aaplAfter = after.positions.find((p: { ticker: string }) => p.ticker === "AAPL")?.quantity ?? 0;
    expect(aaplAfter).toBeCloseTo(aaplBefore + 1);
    expect(after.cash).toBeLessThan(before.cash);
  });

  test("chat can add a ticker to the watchlist and history persists across reload", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("chat-input").fill("add SHOP");
    await page.getByTestId("chat-send-button").click();
    const reply = page.locator('[data-testid="chat-message"][data-role="assistant"]').last();
    await expect(reply).toContainText(/SHOP/);
    await expect(reply.getByTestId("chat-action")).toHaveAttribute("data-status", "executed");
    await expect(page.getByTestId("watchlist-row-SHOP")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("chat-message").filter({ hasText: "buy 1 AAPL" }).first()).toBeVisible();
    await expect(page.getByTestId("watchlist-row-SHOP")).toBeVisible();
  });

  test("a non-command message gets the default mock reply with no actions", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("chat-input").fill("How is my portfolio doing?");
    await page.getByTestId("chat-send-button").click();
    const reply = page.locator('[data-testid="chat-message"][data-role="assistant"]').last();
    await expect(reply).toContainText(/FinAlly mock response/);
    await expect(reply.getByTestId("chat-action")).toHaveCount(0);
  });
});
