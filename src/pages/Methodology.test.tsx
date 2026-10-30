// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Methodology from "./Methodology";
import { TRPCProvider } from "@/providers/trpc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Methodology handbook", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  const originalFetch = globalThis.fetch;
  beforeEach(async () => {
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
    act(() => {
      root = createRoot(host!);
      root.render(<TRPCProvider><MemoryRouter><Methodology /></MemoryRouter></TRPCProvider>);
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
    globalThis.fetch = originalFetch;
  });

  it("renders the complete academic handbook with working section links", () => {
    expect(host!.querySelectorAll(".methodology-section")).toHaveLength(8);
    expect(host!.querySelector('a[href="#expected-move"]')).not.toBeNull();
    expect(host!.querySelector('a[href="/analytics"]')).not.toBeNull();
    expect(host!.textContent).toContain("RV20");
    expect(host!.textContent).toContain("ATM IV");
    expect(host!.textContent).toContain("ΔIC = IC_ATM IV − IC_RV20");
    expect(host!.textContent).toContain("64.85%");
    expect(host!.textContent).toContain("0.0706");
    expect(host!.textContent).toContain("AAPL risk profile");
    expect(host!.textContent).toContain("$11.85");
    expect(host!.textContent).toContain("$8.09");
    expect(host!.textContent).toContain("0.682");
    expect(host!.textContent).toContain("Volatility targeting");
    expect(host!.textContent).toContain("Expected-return normalization");
    expect(host!.textContent).toContain("Risk dashboard");
    expect(host!.querySelector('svg[aria-label="AAPL expected move and risk bands"]')).not.toBeNull();
  });

  it("keeps production limits and academic references visible", () => {
    expect(host!.textContent).toContain("not a directional trading signal");
    expect(host!.querySelectorAll(".methodology-references li")).toHaveLength(7);
  });
});
