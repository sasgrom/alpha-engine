import { describe, expect, it } from "vitest";
import { extractCohortSourceInChunks, splitCohortSourceText } from "./cohort-chunked-extract";
import type { ExpectationStatement } from "./expectations";

const statement = (evidence: string): ExpectationStatement => ({
  kind: "guidance",
  metricRaw: "revenue",
  metric: "revenue",
  scopeRaw: "company",
  periodRaw: "next quarter",
  comparisonRaw: null,
  qualifier: "point",
  valueLow: null,
  valueHigh: null,
  valuePoint: 100,
  tolerance: null,
  toleranceUnit: null,
  valueText: null,
  unit: "usd_billions",
  basis: "gaap",
  currencyBasis: "reported",
  revision: "initial",
  previousLow: null,
  previousHigh: null,
  previousPoint: null,
  previousGuidanceDateRaw: null,
  assumptionRaw: null,
  sourceSection: "Outlook",
  evidence,
});

const generated = (text: string, evalCount: number) => ({
  text: JSON.stringify({ guidanceStatus: "found", statements: [statement(text)], extractionWarnings: [] }),
  model: "qa",
  totalMs: 1,
  loadMs: 0,
  promptEvalCount: 100,
  promptEvalMs: 1,
  evalCount,
  evalMs: 1,
  evalPerSec: 1,
});

describe("chunked cohort extraction", () => {
  it("splits at line boundaries", () => {
    expect(splitCohortSourceText("a\nb\nc", 2)).toEqual(["a", "b", "c"]);
  });

  it("merges parsed statements and reports per-chunk truncation explicitly", async () => {
    const evidence = "Revenue is expected to be $100 billion.";
    const result = await extractCohortSourceInChunks(`${evidence}\n${evidence}\n${evidence}`, { ticker: "AAA", form: "8-K", filingDate: "2026-01-01", accessionNo: "acc" }, 2048, async () => generated(evidence, 8192));
    expect(result.response.guidanceStatus).toBe("found");
    expect(result.response.statements).toHaveLength(1);
    expect(result.outputTruncated).toBe(true);
  });
});
