import type { ExpectationStatement } from "./expectations";
import type { BenchmarkFile, GoldDocument } from "./expectations-benchmark";

export type ExpectationAbEngine = "ollama" | "strata";
export interface ExpectationModelSpec {
  engine: ExpectationAbEngine;
  model: string;
  label: string;
}

const MODEL_SPEC_RE = /^(ollama|strata):(.+)$/;

/** Engine-qualified model spec keeps Ollama and Strata runs explicit and auditable. */
export function parseExpectationModelSpecs(value: string): ExpectationModelSpec[] {
  const specs = value.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = MODEL_SPEC_RE.exec(part);
    if (!match) throw new Error(`Invalid model spec "${part}". Expected ollama:<model> or strata:<model>`);
    const engine = match[1] as ExpectationAbEngine;
    const model = match[2].trim();
    if (!model || /[\r\n]/.test(model)) throw new Error(`Invalid model name in "${part}"`);
    return { engine, model, label: `${engine}:${model}` };
  });
  if (!specs.length) throw new Error("At least one model spec is required");
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.label)) throw new Error(`Duplicate model spec "${spec.label}"`);
    seen.add(spec.label);
  }
  return specs;
}

const GUIDANCE_STATUSES = ["found", "not_found", "explicitly_not_provided", "deferred_to_call"] as const;
const STATEMENT_KINDS = ["guidance", "actual", "assumption", "financing", "timing", "non_disclosure"] as const;
const METRICS = [
  "revenue", "operating_income", "net_income", "eps", "ebitda", "capex", "opex",
  "free_cash_flow", "operating_cash_flow", "debt", "margin", "tax_rate", "nii",
  "expense", "segment_revenue", "segment_profit", "backlog", "other",
] as const;
const QUALIFIERS = ["range", "point", "plus_minus", "at_least", "at_most", "approximately", "unchanged", "qualitative", "not_provided"] as const;
const TOLERANCE_UNITS = ["percent", "basis_points", "same_unit"] as const;
const UNITS = ["usd", "usd_millions", "usd_billions", "usd_per_share", "percent", "basis_points", "ratio", "days", "count", "text", "other"] as const;
const BASES = ["gaap", "non_gaap", "reported", "adjusted", "mixed", "unclear"] as const;
const CURRENCY_BASES = ["reported", "constant_currency", "unclear"] as const;
const REVISIONS = ["initial", "raised", "lowered", "narrowed", "widened", "reaffirmed", "actual", "not_provided", "unclear"] as const;

/**
 * Strict schema for model A/B tests. The production Zod contract was already
 * strict; this also constrains the model-facing JSON schema so enums are not
 * left to prompt compliance alone.
 */
export const EXPECTATION_STRICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    guidanceStatus: { type: "string", enum: [...GUIDANCE_STATUSES] },
    statements: {
      type: "array",
      maxItems: 60,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: [...STATEMENT_KINDS] },
          metricRaw: { type: "string" },
          metric: { type: "string", enum: [...METRICS] },
          scopeRaw: { type: "string" },
          periodRaw: { type: "string" },
          comparisonRaw: { anyOf: [{ type: "string" }, { type: "null" }] },
          qualifier: { type: "string", enum: [...QUALIFIERS] },
          valueLow: { anyOf: [{ type: "number" }, { type: "null" }] },
          valueHigh: { anyOf: [{ type: "number" }, { type: "null" }] },
          valuePoint: { anyOf: [{ type: "number" }, { type: "null" }] },
          tolerance: { anyOf: [{ type: "number" }, { type: "null" }] },
          toleranceUnit: { anyOf: [{ type: "string", enum: [...TOLERANCE_UNITS] }, { type: "null" }] },
          valueText: { anyOf: [{ type: "string" }, { type: "null" }] },
          unit: { type: "string", enum: [...UNITS] },
          basis: { type: "string", enum: [...BASES] },
          currencyBasis: { type: "string", enum: [...CURRENCY_BASES] },
          revision: { type: "string", enum: [...REVISIONS] },
          previousLow: { anyOf: [{ type: "number" }, { type: "null" }] },
          previousHigh: { anyOf: [{ type: "number" }, { type: "null" }] },
          previousPoint: { anyOf: [{ type: "number" }, { type: "null" }] },
          previousGuidanceDateRaw: { anyOf: [{ type: "string" }, { type: "null" }] },
          assumptionRaw: { anyOf: [{ type: "string" }, { type: "null" }] },
          sourceSection: { anyOf: [{ type: "string" }, { type: "null" }] },
          evidence: { type: "string" },
        },
        required: [
          "kind", "metricRaw", "metric", "scopeRaw", "periodRaw", "comparisonRaw", "qualifier",
          "valueLow", "valueHigh", "valuePoint", "tolerance", "toleranceUnit", "valueText",
          "unit", "basis", "currencyBasis", "revision", "previousLow", "previousHigh",
          "previousPoint", "previousGuidanceDateRaw", "assumptionRaw", "sourceSection", "evidence",
        ],
      },
    },
    extractionWarnings: { type: "array", maxItems: 12, items: { type: "string" } },
  },
  required: ["guidanceStatus", "statements", "extractionWarnings"],
} as const;

export interface ExpectationAbCandidate {
  ticker: string;
  cik: number;
  accessionNo: string;
  form: string;
  expectedGuidanceStatus: GoldDocument["expectedGuidanceStatus"];
  requiredStatements: number;
  baselineStatus: "missing_result" | "extracted" | "empty" | "unparsed" | "request_failed" | "fallback" | "fallback_unverified";
  baselineStatements: number;
  hasPack: boolean;
}

const STATUS_RANK: Record<ExpectationAbCandidate["baselineStatus"], number> = {
  fallback_unverified: 0,
  fallback: 1,
  unparsed: 2,
  request_failed: 3,
  missing_result: 4,
  empty: 5,
  extracted: 6,
};

/** Pick the most informative failures first; explicit cases always bypass this heuristic. */
export function chooseExpectationAbCases(candidates: ExpectationAbCandidate[], limit: number): ExpectationAbCandidate[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  return candidates
    .filter((candidate) => candidate.hasPack)
    .sort((a, b) => STATUS_RANK[a.baselineStatus] - STATUS_RANK[b.baselineStatus]
      || b.requiredStatements - a.requiredStatements
      || a.ticker.localeCompare(b.ticker)
      || a.accessionNo.localeCompare(b.accessionNo))
    .slice(0, limit);
}

export interface ExpectationAbRunSummaryInput {
  engine: ExpectationAbEngine;
  model: string;
  schemaValid: boolean;
  evidenceRejected: number;
  statements: ExpectationStatement[];
  wallMs: number;
  totalMs: number;
  promptTokens: number;
  generatedTokens: number;
  error: string | null;
}

export interface ExpectationAbModelSummary {
  engine: ExpectationAbEngine;
  model: string;
  requests: number;
  requestErrors: number;
  schemaValid: number;
  schemaPassRate: number | null;
  statements: number;
  evidenceRejected: number;
  wallMs: number;
  totalMs: number;
  promptTokens: number;
  generatedTokens: number;
  decodeTokensPerSecond: number | null;
  requestsPerMinute: number | null;
}

/** Aggregate without treating fallback prose or schema failures as extraction success. */
export function summarizeExpectationAbRuns(rows: ExpectationAbRunSummaryInput[], spec: ExpectationModelSpec): ExpectationAbModelSummary {
  const mine = rows.filter((row) => row.engine === spec.engine && row.model === spec.model);
  const answered = mine.filter((row) => !row.error);
  const schemaValid = mine.filter((row) => row.schemaValid).length;
  const generatedTokens = mine.reduce((sum, row) => sum + row.generatedTokens, 0);
  const totalMs = mine.reduce((sum, row) => sum + row.totalMs, 0);
  const wallMs = mine.reduce((sum, row) => sum + row.wallMs, 0);
  return {
    engine: spec.engine,
    model: spec.model,
    requests: mine.length,
    requestErrors: mine.filter((row) => row.error).length,
    schemaValid,
    schemaPassRate: answered.length ? schemaValid / answered.length : null,
    statements: mine.reduce((sum, row) => sum + row.statements.length, 0),
    evidenceRejected: mine.reduce((sum, row) => sum + row.evidenceRejected, 0),
    wallMs,
    totalMs,
    promptTokens: mine.reduce((sum, row) => sum + row.promptTokens, 0),
    generatedTokens,
    decodeTokensPerSecond: totalMs > 0 ? generatedTokens / (totalMs / 1000) : null,
    requestsPerMinute: wallMs > 0 ? mine.length / (wallMs / 60_000) : null,
  };
}

/** Benchmark subset used by the runner: selected docs keep their original gold unchanged. */
export function subsetBenchmark(benchmark: BenchmarkFile, accessionNos: Iterable<string>): BenchmarkFile {
  const selected = new Set(accessionNos);
  return { ...benchmark, documents: benchmark.documents.filter((doc) => selected.has(doc.accessionNo)) };
}
