// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpectationReportStatement } from "../../worker/lib/expectations-report";

const statement = vi.hoisted(() => (ticker: string, qualifier: ExpectationReportStatement["qualifier"]): ExpectationReportStatement => ({
  cik: ticker === "AMZN" ? 1018724 : 1045810,
  cohortId: ticker === "AMZN" ? "2026-10-29" : "2002-04-28",
  ticker,
  accessionNo: `acc-${ticker}`,
  form: "8-K",
  filingDate: "2026-10-29",
  sourceUrl: `https://www.sec.gov/${ticker}`,
  kind: "guidance",
  metricRaw: "Revenue",
  metric: "revenue",
  scopeRaw: "Consolidated",
  periodRaw: "Q4 2026",
  comparisonRaw: null,
  qualifier,
  valueLow: qualifier === "range" ? 240 : null,
  valueHigh: qualifier === "range" ? 247 : null,
  valuePoint: qualifier === "plus_minus" ? 108 : null,
  tolerance: qualifier === "plus_minus" ? 2 : null,
  toleranceUnit: qualifier === "plus_minus" ? "percent" : null,
  valueText: null,
  unit: "usd_billions",
  basis: "reported",
  currencyBasis: "reported",
  revision: "initial",
  previousLow: null,
  previousHigh: null,
  previousPoint: null,
  previousGuidanceDateRaw: null,
  assumptionRaw: null,
  sourceSection: "Guidance",
  evidence: `${ticker} revenue guidance is stated explicitly in this source quote`,
}));
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/data/expectations-report", () => ({
  expectationsReport: {
    schemaVersion: 2,
    generatedAt: "2026-10-30T00:00:00Z",
    scope: "test",
    status: "reviewed",
    coverage: { companiesExpected: 53, companiesWithResults: 2, documents: 2, extracted: 2, noCandidate: 0, unparsed: 0, failed: 0, statements: 2, fallback: 2, fallbackUnverified: 0, rejectedEvidence: 0, promptTokens: 100, evalTokens: 20 },
    benchmark: { pass: true, recall: 1, issueCount: 0 },
    companies: [],
    statements: [statement("AMZN", "range"), statement("NVDA", "plus_minus")],
    fallbacks: [{
      cik: 1045810,
      ticker: "NVDA",
      cohortId: "2002-04-28",
      accessionNo: "acc-fallback",
      form: "8-K",
      filingDate: "2002-04-29",
      sourceUrl: "https://www.sec.gov/nvda-fallback",
      summary: "The filing discusses Xbox pricing arbitration and deferred processor revenue.",
      dataQuality: "limited",
      guidancePresence: "unclear",
      limitations: ["No explicit revenue guidance"],
      evidence: "We expect to continue deferring revenue until arbitration is resolved.",
      evidenceVerified: true,
    }, {
      cik: 1018724,
      ticker: "AMZN",
      cohortId: "1999-05-02",
      accessionNo: "acc-amzn-fallback",
      form: "10-Q",
      filingDate: "1999-06-15",
      sourceUrl: "https://www.sec.gov/amzn-fallback",
      summary: "An older Amazon quarterly filing with limited forward guidance.",
      dataQuality: "limited",
      guidancePresence: "unclear",
      limitations: ["Old reporting format"],
      evidence: "A source statement from the older Amazon filing.",
      evidenceVerified: true,
    }],
  },
}));
import Expectations from "./Expectations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Populated expectations report", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { root = createRoot(host!); root.render(<MemoryRouter><Expectations /></MemoryRouter>); });
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it("formats guidance values and exposes source evidence", async () => {
    expect(host!.textContent).toContain("$240.0B–247.0B");
    expect(host!.textContent).toContain("$108.0B ± 2%");
    expect(host!.textContent).toContain("Reviewed research snapshot");
    const details = host!.querySelector("details")!;
    await act(async () => { details.querySelector("summary")!.click(); });
    expect(details.open).toBe(true);
    expect(details.textContent).toContain("AMZN revenue guidance is stated explicitly");
  });

  it("shows factual fallback notes separately from structured statements", async () => {
    const tab = [...host!.querySelectorAll("button")].find((button) => button.textContent?.includes("Fallback notes"))!;
    await act(async () => { tab.click(); });
    expect(host!.textContent).toContain("Factual fallback note");
    expect(host!.textContent).toContain("Xbox pricing arbitration");
    expect(host!.textContent).toContain("evidence verified");
    expect(host!.textContent).toContain("Fallback only · not a factor");
    expect(host!.querySelector('a[href="https://www.sec.gov/nvda-fallback"]')).not.toBeNull();
  });

  it("filters fallback notes by quarter", async () => {
    const tab = [...host!.querySelectorAll("button")].find((button) => button.textContent?.includes("Fallback notes"))!;
    await act(async () => { tab.click(); });
    const select = host!.querySelector('select[aria-label="Filter fallback quarter"]') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "2002-04-28");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host!.querySelectorAll(".expectation-card")).toHaveLength(1);
    expect(host!.textContent).toContain("Xbox pricing arbitration");
    expect(host!.textContent).not.toContain("older Amazon quarterly filing");
  });

  it("filters statements by ticker", async () => {
    const select = host!.querySelector('select[aria-label="Filter ticker"]') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "NVDA");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host!.querySelectorAll(".expectation-card")).toHaveLength(1);
    expect(host!.textContent).toContain("NVDA");
    expect(host!.textContent).not.toContain("$240.0B–247.0B");
  });
});
