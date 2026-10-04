import { exec } from "node:child_process";
import net from "node:net";
import { expect, test } from "@playwright/test";
import { expectPriceToChange, openApp } from "./helpers";

/**
 * A TCP proxy in front of the app, so the test can sever the browser's connection at the
 * network level (PLAN.md §12 "SSE resilience") in both docker-compose and local modes.
 */
class Proxy {
  private server: net.Server | null = null;
  private sockets = new Set<net.Socket>();
  port = 0;

  constructor(private targetHost: string, private targetPort: number) {}

  async start(port = 0): Promise<number> {
    const server = net.createServer((client) => {
      const upstream = net.connect(this.targetPort, this.targetHost);
      this.sockets.add(client);
      this.sockets.add(upstream);
      client.pipe(upstream).pipe(client);
      const done = () => {
        client.destroy();
        upstream.destroy();
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      client.on("error", done).on("close", done);
      upstream.on("error", done).on("close", done);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    this.server = server;
    this.port = (server.address() as net.AddressInfo).port;
    return this.port;
  }

  /** Stop accepting and cut every open connection (the SSE stream included). */
  async sever(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function target(): { host: string; port: number } {
  const u = new URL(process.env.BASE_URL || "http://localhost:8000");
  const host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname;
  return { host, port: Number(u.port || (u.protocol === "https:" ? 443 : 80)) };
}

test.describe("SSE resilience", () => {
  test("connection dot goes green -> not connected -> green and prices resume after a network cut", async ({ page }) => {
    const { host, port } = target();
    const proxy = new Proxy(host, port);
    const proxyPort = await proxy.start();
    try {
      await openApp(page, `http://127.0.0.1:${proxyPort}/`);
      const dot = page.getByTestId("connection-status");
      await expect(dot).toHaveAttribute("data-status", "connected");
      await expectPriceToChange(page, "AAPL");

      await proxy.sever();
      await expect(dot).not.toHaveAttribute("data-status", "connected", { timeout: 10_000 });
      // Keep it down for a few retry cycles.
      await page.waitForTimeout(3_000);
      await expect(dot).not.toHaveAttribute("data-status", "connected");

      await proxy.start(proxyPort);
      await expect(dot).toHaveAttribute("data-status", "connected", { timeout: 20_000 });
      // Prices resume without a page reload.
      await expectPriceToChange(page, "AAPL");
      await expectPriceToChange(page, "MSFT");
    } finally {
      await proxy.sever();
    }
  });

  // Optional: a real app restart. Set APP_RESTART_CMD to a shell command that restarts the
  // server and returns once it is (re)starting, e.g. the local runner's restart script.
  test("connection recovers after a real app restart", async ({ page, request }) => {
    const cmd = process.env.APP_RESTART_CMD;
    test.skip(!cmd, "APP_RESTART_CMD not set");
    await openApp(page);
    const dot = page.getByTestId("connection-status");

    // Run the restart in the background so the dot can be watched while the app is down.
    // The restart command should keep the app down for a couple of seconds before starting it.
    const restarted = new Promise<void>((resolve, reject) =>
      exec(cmd!, { timeout: 90_000 }, (err) => (err ? reject(err) : resolve())),
    );
    await expect(dot).not.toHaveAttribute("data-status", "connected", { timeout: 15_000 });
    await restarted;
    await expect
      .poll(async () => (await request.get("/api/health").catch(() => null))?.status() ?? 0, { timeout: 45_000 })
      .toBe(200);
    await expect(dot).toHaveAttribute("data-status", "connected", { timeout: 20_000 });
    await expectPriceToChange(page, "AAPL");
  });
});
