import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const DEFAULT_TICKERS = ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX"];

/** "$10,000.00" -> 10000 (also handles the unicode minus sign). */
export function parseUsd(text: string | null): number {
  if (!text) return NaN;
  const cleaned = text.replace(/−/g, "-").replace(/[^0-9.\-]/g, "");
  return Number(cleaned);
}

export async function openApp(page: Page, url = "/") {
  await page.goto(url);
  await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected", { timeout: 20_000 });
}

export async function readCash(page: Page): Promise<number> {
  return parseUsd(await page.getByTestId("header-cash").textContent());
}

export async function priceText(page: Page, ticker: string): Promise<string> {
  return ((await page.getByTestId(`watchlist-price-${ticker}`).textContent()) ?? "").trim();
}

/** Wait until the displayed watchlist price for `ticker` differs from what it shows now. */
export async function expectPriceToChange(page: Page, ticker: string, timeout = 15_000) {
  const before = await priceText(page, ticker);
  await expect
    .poll(async () => priceText(page, ticker), { timeout, message: `${ticker} price should update from ${before}` })
    .not.toBe(before);
}

export async function apiPortfolio(request: APIRequestContext) {
  const res = await request.get("/api/portfolio");
  expect(res.ok()).toBeTruthy();
  return res.json();
}

export async function placeTrade(page: Page, ticker: string, quantity: string, side: "buy" | "sell") {
  await page.getByTestId("trade-ticker-input").fill(ticker);
  await page.getByTestId("trade-quantity-input").fill(quantity);
  await page.getByTestId(side === "buy" ? "trade-buy-button" : "trade-sell-button").click();
}
