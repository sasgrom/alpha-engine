// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpectationReportStatement } from "../../worker/lib/expectations-report";

const statement = vi.hoisted(() => (ticker: string, filingDate: string, qualifier: ExpectationReportStatement["qualifier"]): ExpectationReportStatement => ({
  cik: ticker === "AMZN" ? 1018724 : 1045810,
  cohortId: "test-cohort",
  ticker,
  accessionNo: `acc-${ticker}`,
  form: "8-K",
  filingDate,
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

const fixture = vi.hoisted(() => ({
  schemaVersion: 2,
  generatedAt: "2026-11-10T00:00:00Z",
  scope: "deterministic-test-fixture",
  status: "partial",
  coverage: { companiesExpected: 53, companiesWithResults: 2, documents: 2, extracted: 2, noCandidate: 0, unparsed: 0, failed: 0, statements: 2, fallback: 0, fallbackUnverified: 0, rejectedEvidence: 0, promptTokens: 100, evalTokens: 20 },
  benchmark: null,
  companies: [],
  statements: [statement("NVDA", "1999-12-10", "plus_minus"), statement("AMZN", "2026-10-29", "range")],
  fallbacks: [],
}));

vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/data/expectations-report", () => ({ expectationsReport: fixture }));
import Expectations from "./Expectations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Expectations report", () => {
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

  it("shows fixture coverage and an unrun benchmark without implying reviewed status", () => {
    expect(host!.textContent).toContain("Local results · review required");
    const { coverage } = fixture;
    expect(host!.textContent).toContain(`${coverage.companiesWithResults} / ${coverage.companiesExpected}`);
    expect(host!.textContent).toContain(coverage.documents.toLocaleString("en-US"));
    expect(host!.textContent).toContain(coverage.statements.toLocaleString("en-US"));
    expect(host!.textContent).toContain("Not run");
    expect(host!.textContent).not.toContain("Waiting for home extraction");
    expect(host!.querySelectorAll(".expectation-card")).toHaveLength(Math.min(120, fixture.statements.length));
  });

  it("orders statement cards by latest filing date instead of oldest first", () => {
    const cards = [...host!.querySelectorAll(".expectation-card")];
    const actualDates = cards.map((card) => card.textContent?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "");
    const expectedDates = fixture.statements.map((statement) => statement.filingDate).sort((a, b) => b.localeCompare(a)).slice(0, 120);
    expect(actualDates).toEqual(expectedDates);
    const latest = fixture.statements.map((statement) => statement.filingDate).sort().at(-1)!;
    expect(cards[0].textContent).toContain(latest);
    expect(cards[0].textContent).not.toContain("1999-12-10");
  });

  it("offers real SEC reference examples in a separate, clearly labeled tab", async () => {
    const tab = [...host!.querySelectorAll("button")].find((button) => button.textContent?.includes("SEC reference examples"))!;
    await act(async () => { tab.click(); });
    expect(host!.querySelectorAll(".expectation-card")).toHaveLength(6);
    expect(host!.textContent).toContain("$240–247 billion");
    expect(host!.textContent).toContain("$108.0 billion ± 2%");
    expect(host!.textContent).toContain("Not an accuracy result");
    expect(host!.querySelector('a[href*="amzn-20260930xex991.htm"]')).not.toBeNull();
  });
});
