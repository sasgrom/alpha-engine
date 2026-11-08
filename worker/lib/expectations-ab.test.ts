import { describe, expect, it } from "vitest";
import {
  chooseExpectationAbCases,
  EXPECTATION_STRICT_JSON_SCHEMA,
  parseExpectationModelSpecs,
  subsetBenchmark,
  summarizeExpectationAbRuns,
  type ExpectationAbCandidate,
} from "./expectations-ab";
import type { BenchmarkFile } from "./expectations-benchmark";

describe("expectations model A/B helpers", () => {
  it("parses engine-qualified model specs and rejects ambiguous duplicates", () => {
    expect(parseExpectationModelSpecs("ollama:qwen3.5:9b, strata:qwen-test")).toEqual([
      { engine: "ollama", model: "qwen3.5:9b", label: "ollama:qwen3.5:9b" },
      { engine: "strata", model: "qwen-test", label: "strata:qwen-test" },
    ]);
    expect(() => parseExpectationModelSpecs("qwen3.5:9b")).toThrow(/ollama:<model> or strata:<model>/);
    expect(() => parseExpectationModelSpecs("ollama:a,ollama:a")).toThrow(/Duplicate/);
  });

  it("makes enum contracts explicit in the model-facing strict schema", () => {
    const statement = EXPECTATION_STRICT_JSON_SCHEMA.properties.statements.items.properties;
    expect(EXPECTATION_STRICT_JSON_SCHEMA.properties.guidanceStatus.enum).toContain("found");
    expect(statement.kind.enum).toContain("non_disclosure");
    expect(statement.metric.enum).toContain("capex");
    expect(statement.qualifier.enum).toContain("range");
    expect(statement.unit.enum).toContain("usd_billions");
    expect(statement.revision.enum).toContain("narrowed");
  });

  it("selects fallback and unparsed benchmark cases before already-valid extraction", () => {
    const base: Omit<ExpectationAbCandidate, "ticker" | "cik" | "accessionNo" | "baselineStatus" | "requiredStatements"> = {
      form: "8-K",
      expectedGuidanceStatus: "found",
      baselineStatements: 0,
      hasPack: true,
    };
    const candidates: ExpectationAbCandidate[] = [
      { ...base, ticker: "A", cik: 1, accessionNo: "a", baselineStatus: "extracted", requiredStatements: 5 },
      { ...base, ticker: "B", cik: 2, accessionNo: "b", baselineStatus: "fallback_unverified", requiredStatements: 1 },
      { ...base, ticker: "C", cik: 3, accessionNo: "c", baselineStatus: "fallback", requiredStatements: 4 },
      { ...base, ticker: "D", cik: 4, accessionNo: "d", baselineStatus: "unparsed", requiredStatements: 3, hasPack: false },
    ];
    expect(chooseExpectationAbCases(candidates, 2).map((candidate) => candidate.ticker)).toEqual(["B", "C"]);
  });

  it("aggregates schema pass and speed without counting errors as valid output", () => {
    const summary = summarizeExpectationAbRuns([
      { engine: "ollama", model: "m", schemaValid: true, evidenceRejected: 1, statements: [], wallMs: 1000, totalMs: 800, promptTokens: 100, generatedTokens: 20, error: null },
      { engine: "ollama", model: "m", schemaValid: false, evidenceRejected: 0, statements: [], wallMs: 1000, totalMs: 200, promptTokens: 100, generatedTokens: 10, error: "timeout" },
    ], { engine: "ollama", model: "m", label: "ollama:m" });
    expect(summary.requests).toBe(2);
    expect(summary.requestErrors).toBe(1);
    expect(summary.schemaPassRate).toBe(1);
    expect(summary.generatedTokens).toBe(30);
    expect(summary.decodeTokensPerSecond).toBe(30);
  });

  it("keeps benchmark gold immutable when selecting a subset", () => {
    const benchmark: BenchmarkFile = {
      benchmarkId: "gold",
      reviewMethod: "test",
      documents: [
        { ticker: "A", cik: 1, accessionNo: "a", form: "8-K", url: "", expectedGuidanceStatus: "found", required: [] },
        { ticker: "B", cik: 2, accessionNo: "b", form: "8-K", url: "", expectedGuidanceStatus: "not_found", required: [] },
      ],
    };
    const subset = subsetBenchmark(benchmark, ["b"]);
    expect(subset.documents.map((doc) => doc.accessionNo)).toEqual(["b"]);
    expect(benchmark.documents).toHaveLength(2);
  });
});
