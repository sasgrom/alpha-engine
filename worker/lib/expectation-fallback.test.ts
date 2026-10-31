import { describe, expect, it } from "vitest";
import {
  buildExpectationFallbackPrompt,
  EXPECTATION_FALLBACK_VERSION,
  fallbackEvidenceVerified,
  parseExpectationFallback,
} from "./expectation-fallback";

const valid = JSON.stringify({
  summary: "The filing discusses Xbox pricing arbitration and deferred processor revenue.",
  dataQuality: "limited",
  guidancePresence: "unclear",
  limitations: ["No explicit revenue or margin guidance is provided", "The matter is subject to arbitration"],
  evidence: "We expect that we will continue to defer such amount on future sales of this processor until resolution of the matter.",
});

describe("expectation fallback", () => {
  it("parses a factual fallback note and verifies source evidence", () => {
    const result = parseExpectationFallback(valid);
    expect(result?.dataQuality).toBe("limited");
    expect(result?.guidancePresence).toBe("unclear");
    expect(fallbackEvidenceVerified(result!, "We expect that we will continue to defer such amount on future sales of this processor until resolution of the matter.")).toBe(true);
  });

  it("rejects invalid or empty responses and unsupported evidence", () => {
    expect(parseExpectationFallback("not json")).toBeNull();
    expect(parseExpectationFallback(JSON.stringify({ summary: "x" }))).toBeNull();
    const result = parseExpectationFallback(valid)!;
    expect(fallbackEvidenceVerified(result, "A completely different source sentence.")).toBe(false);
  });

  it("forbids prior knowledge, market judgments and age-only rejection", () => {
    const prompt = buildExpectationFallbackPrompt("source", { ticker: "NVDA", form: "8-K", filingDate: "2002-04-29", accessionNo: "0000950168-02-001118" });
    expect(prompt).toContain(EXPECTATION_FALLBACK_VERSION);
    expect(prompt).toContain("Never use prior knowledge or other documents");
    expect(prompt).toContain("Do not predict market reaction, valuation or trade direction");
    expect(prompt).toContain("Do not assign a numeric confidence score");
    expect(prompt).toContain("Do not turn old age alone into unusable data");
  });
});
