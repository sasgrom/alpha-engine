// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: class { constructor() { throw new Error("WebGL unavailable"); } },
}));
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/providers/trpc", () => ({
  trpc: {
    admin: {
      fundFlows: {
        useQuery: () => ({
          data: {
            funds: [{ cik: 1, name: "Fund A", tier: "fundamental" }],
            companies: [{ cik: 2, ticker: "AAA", sector: "Information Technology" }, { cik: 3, ticker: "BBB", sector: "Financials" }],
            edges: [
              { fundCik: 1, cik: 2, curUsd: 200, deltaUsd: 100, curShares: 20, deltaShares: 10, deltaWeightPp: 0.1 },
              { fundCik: 1, cik: 3, curUsd: 100, deltaUsd: -50, curShares: 10, deltaShares: -5, deltaWeightPp: -0.2 },
            ],
            guard: { cur: "2026-06-30", prev: "2026-03-31", expectedFunds: 1, curFunds: 1, skippedLatestQuarter: null, partial: true, warnings: [], stableFunds: 1, missingFunds: 0, suspectFunds: 0 },
          },
          isLoading: false,
          isError: false,
        }),
      },
    },
  },
}));

import FundFlows from "./FundFlows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Fund Flows accessible fallback", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { root = createRoot(host!); root.render(<MemoryRouter><FundFlows /></MemoryRouter>); });
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("shows the same evidence in a table when WebGL is unavailable", async () => {
    expect(host!.textContent).toContain("3D is unavailable in this browser");
    expect(host!.textContent).toContain("Fund A");
    expect(host!.textContent).toContain("AAA");
    expect(host!.textContent).toContain("BBB");
    const input = host!.querySelector("input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "AAA");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const rows = host!.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("AAA");
    expect(rows[0].textContent).not.toContain("BBB");
  });
});
