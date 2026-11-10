// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InsiderActivity from "./InsiderActivity";

vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fullFeed = {
  schemaVersion: 1,
  status: "full_run",
  generatedAt: "2026-11-10T12:00:00.000Z",
  universe: 50,
  totals: { accessions: 1, transactions: 1, clusters: 1 },
  kpi: { openMarketBuyCount: 1, openMarketBuyUsd: 9709680, excludedCount: 0, excludedUsd: 0, uniqueInsidersBuying: 2, multiOwnerTransactions: 1 },
  perTicker: [{ ticker: "INTC", openMarketBuyCount: 1, openMarketBuyUsd: 9709680, excludedCount: 0, excludedUsd: 0, uniqueInsidersBuying: 2, multiOwnerTransactions: 1, clusters: 1 }],
  transactions: [{
    accessionNo: "0000050863-26-000195",
    issuerCik: 50863,
    ticker: "INTC",
    eventTs: "2026-11-02",
    availableAt: "2026-11-04 12:19:10",
    transactionCode: "P",
    transactionFormType: "4",
    equitySwapInvolved: false,
    shares: 150000,
    pricePerShare: 64.7312,
    valueUsd: 9709680,
    acquiredDisposedCode: "A",
    directOrIndirect: "I",
    natureOfOwnership: "by Family Trust",
    sharesOwnedAfter: 1464669,
    ownerCik: 1008463,
    owners: [
      { ownerCik: 1008463, rptOwnerName: "TAN LIP BU", isDirector: true, isOfficer: true, isTenPercentOwner: false, isOther: false, officerTitle: "CEO", otherText: null },
      { ownerCik: 2000000, rptOwnerName: "Joint Owner", isDirector: false, isOfficer: false, isTenPercentOwner: true, isOther: false, officerTitle: null, otherText: null },
    ],
    multiOwner: true,
    rptOwnerName: "TAN LIP BU",
    isDirector: true,
    isOfficer: true,
    isTenPercentOwner: false,
    officerTitle: "CEO",
    exclusionReason: null,
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/50863/000005086326000195/form4.xml",
    clusterId: "insider_buy_cluster_v1:50863:2026-11-02:abc",
  }],
  clusters: [{
    clusterId: "insider_buy_cluster_v1:50863:2026-11-02:abc",
    ticker: "INTC",
    windowStart: "2026-11-02",
    windowEnd: "2026-11-04",
    availableAt: "2026-11-04 12:19:10",
    status: "computed",
    uniqueInsiders: 2,
    multiOwner: true,
    hasCeo: true,
    hasCfo: false,
    hasDirector: true,
    hasTenPercentOwner: true,
    aggregatePurchaseUsd: 9709680,
    maxSinglePurchaseUsd: 9709680,
  }],
  benchmarkRuns: [{
    generatedAt: "2026-11-10T06:49:42.087Z",
    dryRun: true,
    notProductionAlpha: true,
    priceCoverage: { status: "degraded", latestDate: "2026-11-06", note: "Price history ended 2026-11-06" },
    horizons: {
      forward1d: { hitRate: 0.3907407407, medianExcess: -0.005, coverage: 0.9926470588 },
      forward5d: { hitRate: 0.4096834264, medianExcess: -0.006, coverage: 0.9871323529 },
      forward20d: { hitRate: 0.4789272031, medianExcess: -0.01, coverage: 0.9595588235 },
    },
  }, {
    generatedAt: "2026-11-10T12:00:00.000Z",
    dryRun: true,
    notProductionAlpha: true,
    priceCoverage: { status: "current", latestDate: "2026-11-09" },
    horizons: {
      forward1d: { hitRate: 0.5341959335, medianExcess: 0.001, coverage: 0.9944852941 },
      forward5d: { hitRate: 0.5185873606, medianExcess: 0.007, coverage: 0.9889705882 },
      forward20d: { hitRate: 0.5095785441, medianExcess: 0.01, coverage: 0.9595588235 },
    },
  }],
};

describe("Insider Activity full-run loading and preview fallback", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => { root = createRoot(host!); root.render(<MemoryRouter><InsiderActivity /></MemoryRouter>); });
  }

  it("uses the preview module only for a 404 and shows the preview banner", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await render();
    expect(host!.textContent).toContain("preview sample");
    expect(host!.textContent).toContain("Preview sample — two real EDGAR filings");
    expect(host!.textContent).not.toContain("full run ·");
  });

  it("loads full-run transactions, clusters, multi-owner markers and the honest benchmark", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fullFeed), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    expect(fetchMock).toHaveBeenCalledWith("/reports/insider-form4.json", { cache: "no-store" });
    expect(host!.textContent).toContain("full run · 2026-11-10 · 1 tx");
    expect(host!.textContent).toContain("multi-owner · 2");
    expect(host!.textContent).toContain("cluster linked");
    expect(host!.textContent).toContain("degraded · price coverage through 2026-11-06");
    expect(host!.textContent).toContain("price coverage through 2026-11-09");
    expect(host!.textContent).toContain("39.1% hit · 99.3% coverage");
    expect(host!.textContent).toContain("53.4% hit · 99.4% coverage");
    expect(host!.textContent).toContain("window-sensitive dry-run, no CI, not a standalone signal");
    expect(host!.textContent).not.toContain("Preview sample — two real EDGAR filings");
  });

  it("does not substitute preview data for server or malformed-report failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    await render();
    expect(host!.textContent).toContain("HTTP 500");
    expect(host!.textContent).toContain("Preview was not substituted");
    expect(host!.textContent).not.toContain("Preview sample — two real EDGAR filings");
  });
});
