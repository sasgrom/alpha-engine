import { describe, expect, it } from "vitest";
import { buildSchwabFundamentalGapMap, mapSchwabFundamentalGap } from "./schwab-fundamental-gap-map";
import type { EdgarGapAnalysis } from "./edgar-gap-analysis";
import type { SchwabContextReport } from "../../worker/lib/schwab-context";

const gaps: EdgarGapAnalysis = {
  schemaVersion: 1, generatedAt: "2026-10-31T00:00:00Z", sourceGeneratedAt: "2026-10-30T00:00:00Z", since: "2000-01-01",
  summary: { errors: 0, warnings: 0, continuityIssues: 0, continuityQuarters: 0, excludedPre2000: 0 },
  byType: [], byCik: [], byEra: [], omittedGaps: 0,
  gaps: [
    { cik: 320193, concept: "EarningsPerShareDiluted", missingQuarters: ["2024Q1"], firstMissingPeriod: "2024Q1", lastMissingPeriod: "2024Q1", recommendedAction: "refresh" },
    { cik: 320193, concept: "StockholdersEquity", missingQuarters: ["2024Q1"], firstMissingPeriod: "2024Q1", lastMissingPeriod: "2024Q1", recommendedAction: "refresh" },
    { cik: 320193, concept: "NetCashProvidedByUsedInOperatingActivities", missingQuarters: ["2024Q1"], firstMissingPeriod: "2024Q1", lastMissingPeriod: "2024Q1", recommendedAction: "refresh" },
    { cik: 320193, concept: "Assets", missingQuarters: ["2024Q1"], firstMissingPeriod: "2024Q1", lastMissingPeriod: "2024Q1", recommendedAction: "refresh" },
    { cik: 320193, concept: "AccountsPayable", missingQuarters: ["2024Q1"], firstMissingPeriod: "2024Q1", lastMissingPeriod: "2024Q1", recommendedAction: "refresh" },
  ],
};
const context: SchwabContextReport = {
  schemaVersion: 1, generatedAt: "2026-10-31T00:00:00Z", provider: "schwab", coverage: { expected: 1, complete: 1, errors: 0 },
  hours: { equity: { date: "2026-10-31", isOpen: true, isHoliday: false, regularMarket: [] }, option: { date: "2026-10-31", isOpen: false, isHoliday: false, regularMarket: [] } },
  movers: [], instruments: [{ symbol: "AAPL", cusip: "037833100", description: "Apple", exchange: "NASDAQ", assetType: "EQUITY", assetMainType: "EQUITY", fundamental: { epsTTM: 8.7, eps: 7.46, sharesOutstanding: 100, bookValuePerShare: 7.36, pcfRatio: 25, marketCap: 1000, returnOnAssets: 27 } }],
  intraday: [], files: [{ kind: "instrument/AAPL", capturedAt: "2026-10-31T12:00:00Z", sourceHash: "instrument-sha", status: "complete" }],
};

describe("Schwab fundamental gap mapping", () => {
  it("allows direct candidates only for real provider fields", () => {
    const candidate = mapSchwabFundamentalGap("EarningsPerShareDiluted", context.instruments[0]);
    expect(candidate.status).toBe("direct_candidate");
    expect(candidate.schwabFields).toEqual(["epsTTM", "eps"]);
    expect(candidate.usage).toBe("current_provider_feature");
  });

  it("marks derived valuation formulas as approximations and rejects unsupported XBRL concepts", () => {
    expect(mapSchwabFundamentalGap("StockholdersEquity", context.instruments[0]).status).toBe("derived_candidate");
    expect(mapSchwabFundamentalGap("NetCashProvidedByUsedInOperatingActivities", context.instruments[0]).formula).toBe("marketCap / pcfRatio");
    expect(mapSchwabFundamentalGap("Assets", context.instruments[0]).status).toBe("unsupported");
    expect(mapSchwabFundamentalGap("AccountsPayable", context.instruments[0]).status).toBe("unsupported");
  });

  it("builds a coverage summary without treating direct fields as vintage replacements", () => {
    const report = buildSchwabFundamentalGapMap(gaps, context, { 320193: "AAPL" }, "2026-10-31T01:00:00Z");
    expect(report.coverage.direct).toBe(1);
    expect(report.coverage.derived).toBe(2);
    expect(report.coverage.unsupported).toBe(2);
    const direct = report.candidates.find((candidate) => candidate.status === "direct_candidate");
    expect(direct?.reason).toContain("provider feature");
    expect(direct?.capturedAt).toBe("2026-10-31T12:00:00Z");
    expect(direct?.sourceHash).toBe("instrument-sha");
  });
});
