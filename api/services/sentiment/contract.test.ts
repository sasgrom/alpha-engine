/**
 * Scoring-contract tests (services/sentiment/contract.ts).
 * The most important part is the anti-hallucination evidence check: a quote
 * must be a verbatim substring of the source (after whitespace
 * normalization). It is the only machine guard against LLM-fabricated
 * justifications.
 */
import { describe, it, expect } from "vitest";
import { ASPECTS, validateScoreResult, type SectionScoreResult } from "./contract";

const SOURCE = "Revenue grew 12% year over year.\n\nOur gross margin expanded to 46.3%.\nLiquidity remains strong.";

/** A valid reference result: evidence values are real substrings of SOURCE. */
function validResult(): SectionScoreResult {
  const mk = (score: number, evidence: string) => ({ score, confidence: 0.8, evidence });
  return {
    aspects: {
      outlook: mk(0.5, "Revenue grew 12% year over year."),
      demand: mk(0.5, "Revenue grew 12% year over year."),
      margins: mk(1, "gross margin expanded to 46.3%"),
      liquidity: mk(0.5, "Liquidity remains strong."),
      capex: mk(0, "Revenue grew 12% year over year."),
      capital_return: mk(0, "Revenue grew 12% year over year."),
      legal_reg: mk(0, "Revenue grew 12% year over year."),
      accounting: mk(0, "Revenue grew 12% year over year."),
    },
    tone_delta: null,
  };
}

describe("validateScoreResult", () => {
  it("accepts a valid single-period result", () => {
    const r = validateScoreResult(validResult(), SOURCE, { expectToneDelta: false });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("rejects a fabricated quote (hallucination guard)", () => {
    const bad = validResult();
    bad.aspects.margins.evidence = "gross margin collapsed to 12%"; // not present in the source
    const r = validateScoreResult(bad, SOURCE, { expectToneDelta: false });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.aspect === "margins" && i.problem.includes("not found"))).toBe(true);
  });

  it("a quote with different line wrapping passes (whitespace normalization)", () => {
    const ok = validResult();
    ok.aspects.margins.evidence = "gross margin\nexpanded\nto 46.3%";
    expect(validateScoreResult(ok, SOURCE, { expectToneDelta: false }).ok).toBe(true);
  });

  it("rejects score outside [-1,1] and confidence outside [0,1]", () => {
    const bad = validResult();
    bad.aspects.outlook.score = 1.5;
    bad.aspects.demand.confidence = -0.2;
    const r = validateScoreResult(bad, SOURCE, { expectToneDelta: false });
    expect(r.issues.some((i) => i.problem.includes("score out of"))).toBe(true);
    expect(r.issues.some((i) => i.problem.includes("confidence out of"))).toBe(true);
  });

  it("single-period mode: tone_delta must be null", () => {
    const bad = validResult();
    bad.tone_delta = { score: 0.1, confidence: 0.5, evidence: "Revenue grew 12% year over year." };
    const r = validateScoreResult(bad, SOURCE, { expectToneDelta: false });
    expect(r.ok).toBe(false);
  });

  it("pairwise mode: tone_delta is required and also checked", () => {
    const missing = validResult(); // tone_delta = null
    expect(validateScoreResult(missing, SOURCE, { expectToneDelta: true }).ok).toBe(false);

    const ok = validResult();
    ok.tone_delta = { score: 0.3, confidence: 0.7, evidence: "Liquidity remains strong." };
    expect(validateScoreResult(ok, SOURCE, { expectToneDelta: true }).ok).toBe(true);
  });

  it("taxonomy: exactly 8 aspects, stable order (JSON-schema keys)", () => {
    expect(ASPECTS).toEqual([
      "outlook", "demand", "margins", "liquidity",
      "capex", "capital_return", "legal_reg", "accounting",
    ]);
  });
});
