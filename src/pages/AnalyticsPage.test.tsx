// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Analytics from "./Analytics";

vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
import { TRPCProvider } from "@/providers/trpc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Analytics volatility lab tile", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  const originalFetch = globalThis.fetch;
  beforeEach(async () => {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      let json: unknown = null;
      if (url.includes("auth.me")) json = { id: 1, username: "qa", name: "QA", role: "admin" };
      else if (url.includes("jobs.list")) json = [];
      else if (url.includes("workersLocal.enabled")) json = false;
      else if (url.includes("dashboard.stats")) json = { runningJobs: 0, queuedJobs: 0 };
      else if (url.includes("messages.unreadCount")) json = { count: 0 };
      else if (url.includes("activity.track")) json = { ok: true };
      else return originalFetch(input, init);
      return { ok: true, status: 200, json: async () => [{ result: { data: { json } } }] } as Response;
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host!);
      root.render(<TRPCProvider><MemoryRouter><Analytics /></MemoryRouter></TRPCProvider>);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
    globalThis.fetch = originalFetch;
  });

  it("links to the volatility methodology handbook prominently", () => {
    const tile = host!.querySelector('a.methodology-tile');
    expect(tile).not.toBeNull();
    expect(tile!.textContent).toContain("Volatility Lab");
    expect(tile!.textContent).toContain("Notation, expected move, paired baselines and an AAPL risk-profile example");
    expect(host!.querySelector('a[href="/analytics/risk-lab"]')).not.toBeNull();
  });
});
