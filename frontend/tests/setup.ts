import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { MockEventSource } from "./mocks";

Object.defineProperty(globalThis, "EventSource", { value: MockEventSource, writable: true });

afterEach(() => {
  cleanup();
  MockEventSource.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
