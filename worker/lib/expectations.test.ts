import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  buildExpectationPrompt,
  evidenceInSource,
  EXPECTATIONS_PROMPT_VERSION,
  parseExpectationResponse,
  rejectUnsupportedStatements,
  selectExpectationText,
} from "./expectations";

const statement = (overrides: Record<string, unknown> = {}) => ({
  kind: "guidance",
  metricRaw: "Net sales",
  metric: "revenue",
  scopeRaw: "Consolidated",
  periodRaw: "Fourth Quarter 2026",
  comparisonRaw: "Fourth Quarter 2025",
  qualifier: "range",
  valueLow: 240,
  valueHigh: 247,
  valuePoint: null,
  tolerance: null,
  toleranceUnit: null,
  valueText: null,
  unit: "usd_billions",
  basis: "reported",
  currencyBasis: "reported",
  revision: "initial",
  previousLow: null,
  previousHigh: null,
  previousPoint: null,
  previousGuidanceDateRaw: null,
  assumptionRaw: "Approximately 60 basis points of FX headwind",
  sourceSection: "Fourth Quarter 2026 Guidance",
  evidence: "Net sales are expected to be between $240.0 billion and $247.0 billion",
  ...overrides,
});
const reply = (statements: unknown[] = [statement()], guidanceStatus = "found") => JSON.stringify({ guidanceStatus, statements, extractionWarnings: [] });

describe("expectations extraction contract", () => {
  it("parses an Amazon-style range without calculating a midpoint", () => {
    const result = parseExpectationResponse(reply());
    expect(result?.guidanceStatus).toBe("found");
    expect(result?.statements[0]).toMatchObject({ valueLow: 240, valueHigh: 247, valuePoint: null, unit: "usd_billions" });
  });

  it("supports floors, point estimates with tolerance and qualitative outlooks", () => {
    const result = parseExpectationResponse(reply([
      statement({ metricRaw: "Adjusted EPS", metric: "eps", qualifier: "at_least", valueLow: 20.5, valueHigh: null, unit: "usd_per_share", basis: "non_gaap" }),
      statement({ metricRaw: "Revenue", qualifier: "plus_minus", valueLow: null, valueHigh: null, valuePoint: 108, tolerance: 2, toleranceUnit: "percent" }),
      statement({ metricRaw: "Advertising growth", qualifier: "qualitative", valueLow: null, valueHigh: null, valueText: "high teens", unit: "percent" }),
    ]));
    expect(result?.statements).toHaveLength(3);
    expect(result?.statements[0].qualifier).toBe("at_least");
    expect(result?.statements[1].tolerance).toBe(2);
    expect(result?.statements[2].valueText).toBe("high teens");
  });

  it("preserves prior guidance vintages and non-disclosure states", () => {
    const result = parseExpectationResponse(reply([
      statement({ revision: "raised", previousLow: 59.5, previousHigh: 62.5, valueLow: 60.5, valueHigh: 62.5 }),
      statement({ kind: "non_disclosure", metricRaw: "Full-year 2027 revenue", qualifier: "not_provided", valueLow: null, valueHigh: null, revision: "not_provided" }),
    ], "explicitly_not_provided"));
    expect(result?.statements[0].previousLow).toBe(59.5);
    expect(result?.statements[1].kind).toBe("non_disclosure");
    expect(result?.guidanceStatus).toBe("explicitly_not_provided");
  });

  it("rejects malformed or incomplete JSON rather than storing guesses", () => {
    expect(parseExpectationResponse("not json")).toBeNull();
    expect(parseExpectationResponse(JSON.stringify({ guidanceStatus: "found", statements: [{ metric: "revenue" }] }))).toBeNull();
  });

  it("verifies contiguous evidence with normalized whitespace and rejects invented quotes", () => {
    const source = "Net sales are expected to be between\n$240.0 billion and $247.0 billion, or to grow.";
    expect(evidenceInSource("net sales are expected to be between $240.0 billion and $247.0 billion", source)).toBe(true);
    const checked = rejectUnsupportedStatements(parseExpectationResponse(reply([
      statement(),
      statement({ metricRaw: "Invented metric", evidence: "Revenue will grow exactly 900% next year" }),
    ]))!, source);
    expect(checked.response.statements).toHaveLength(1);
    expect(checked.rejected).toBe(1);
  });

  it("routes 10-K/10-Q guidance sections but ignores accounting guidance", () => {
    const plain = [
      "ITEM 7. MD&A",
      "Third Quarter 2026 Guidance",
      "Net sales are expected to be between $197.0 billion and $202.0 billion, or to grow between 9% and 12%.",
      "This guidance assumes no acquisitions.",
      "RECENT ACCOUNTING GUIDANCE",
      "The FASB issued accounting guidance about tax disclosures.",
    ].join("\n");
    const selected = selectExpectationText(plain, "10-Q");
    expect(selected.status).toBe("ok");
    expect(selected.text).toContain("$197.0 billion");
    expect(selected.text).toContain("Third Quarter 2026 Guidance");
  });

  it("uses numeric expectation fallback for bank outlook embedded in MD&A", () => {
    const plain = [
      "MD&A",
      "Management commentary",
      "The Firm provided the following outlook information on July 14, 2026:",
      "Management expects net interest income to be approximately $105.5 billion and adjusted expense to be approximately $107.5 billion, market dependent.",
      "Endnote",
    ].join("\n");
    const selected = selectExpectationText(plain, "10-Q");
    expect(selected.status).toBe("ok");
    expect(selected.text).toContain("$105.5 billion");
  });

  it("returns an honest no-candidate status when only accounting guidance exists", () => {
    const selected = selectExpectationText("RECENT ACCOUNTING GUIDANCE\nThe FASB issued guidance about income taxes effective in 2027 with a 5% disclosure threshold.", "10-K");
    expect(selected.status).toBe("no_candidate_text");
    expect(selected.text).toBe("");
  });

  it("keeps small earnings exhibits whole so actuals and guidance stay comparable", () => {
    const plain = "Actual revenue was $90 billion.\nOutlook\nRevenue is expected to be $108.0 billion, plus or minus 2%.";
    const selected = selectExpectationText(plain, "8-K");
    expect(selected.text).toBe(plain);
    expect(selected.blocks).toBe(1);
  });

  it("keeps extraction separate from tone and investor psychology", () => {
    const prompt = buildExpectationPrompt("Revenue is expected to be $108.0 billion.", { ticker: "NVDA", form: "8-K", filingDate: "2026-08-26", accessionNo: "0001045810-26-000073" });
    expect(prompt).toContain(EXPECTATIONS_PROMPT_VERSION);
    expect(prompt).toContain("do not score sentiment");
    expect(prompt).toContain("do not predict market reaction");
    expect(prompt).toContain("contiguous verbatim quote");
  });

  it("freezes the expectations research protocol with an intact checksum", () => {
    const bytes = readFileSync("research/expectations-protocol.json");
    const protocol = JSON.parse(bytes.toString("utf8"));
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(readFileSync("research/expectations-protocol.sha256", "utf8")).toContain(digest);
    expect(protocol.extraction.promptVersion).toBe(EXPECTATIONS_PROMPT_VERSION);
    expect(protocol.extraction.candidateDryRun).toEqual({ documents: 36, routed: 31, noCandidateText: 5 });
    expect(protocol.oosUsedForTuning).toBe(false);
    expect(protocol.validation.productionBlockedUntil).toContain("multi_exhibit_coverage_passes");
  });
});
