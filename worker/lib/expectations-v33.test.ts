import { describe, expect, it } from "vitest";
import { assertV32OtherResultsByteIdentical, extractionContextFor, mergeV33Results } from "./expectations-v33";
import type { CohortResultEntry } from "./cohort-checkpoint";
import type { CanonicalExpectationStatement } from "./expectation-normalization";

const entry = (cik: number, sourceId: string): CohortResultEntry & { statements: CanonicalExpectationStatement[] } => ({
  cik,
  ticker: String(cik),
  cohortId: "2026-09-30",
  containerId: "container",
  sourceId,
  accessionNo: "acc",
  form: "8-K",
  filingDate: "2026-01-01",
  eventTs: "2026-01-01 00:00:00",
  reportDate: "2025-12-31",
  sourceFile: "source.htm",
  inputSha256: "hash",
  model: "qwen3.5:9b",
  promptVersion: "expectations-v4",
  status: "extracted",
  guidanceStatus: "found",
  statements: [],
  extractionWarnings: [],
  rejectedEvidence: 0,
  rawResponse: null,
  fallback: null,
  fallbackRawResponse: null,
  fallbackUsage: null,
  usage: null,
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("Expectations v3.3 merge", () => {
  it("replaces only trio results and preserves other results byte-for-byte", () => {
    const base = [entry(1, "a"), entry(1018724, "old")];
    const healed = [entry(1018724, "old"), entry(1018724, "new")];
    const merged = mergeV33Results(base, healed);
    expect(merged).toHaveLength(3);
    expect(merged[0].sourceId).toBe("a");
    expect(assertV32OtherResultsByteIdentical(base, merged)).toBe(true);
  });

  it("removes stale v3.2 results for healed companies", () => {
    const base = [entry(1, "unchanged"), entry(1018724, "stale")];
    const healed = [entry(1018724, "healed")];
    const merged = mergeV33Results(base, healed);
    expect(merged.map((result) => result.sourceId)).toEqual(["unchanged", "healed"]);
  });

  it("fails closed if an unchanged company is modified", () => {
    const base = [entry(1, "a")];
    const merged = mergeV33Results(base, []);
    merged[0] = { ...merged[0], status: "empty" };
    expect(() => assertV32OtherResultsByteIdentical(base, merged)).toThrow("differ from v3.2");
  });

  it("keeps one extraction context per company", () => {
    expect(extractionContextFor(1018724, 32768)).toBe("ollama_ctx_131072");
    expect(extractionContextFor(1045810, 262144)).toBe("ollama_ctx_262144");
  });
});
