import { evidenceInSource, type ExpectationResponse, type ExpectationStatement } from "./expectations";

export interface GoldStatement {
  kind?: ExpectationStatement["kind"];
  metric: ExpectationStatement["metric"];
  scopeAny: string[];
  periodAny: string[];
  qualifier: ExpectationStatement["qualifier"];
  low?: number;
  high?: number;
  point?: number;
  tolerance?: number;
  toleranceUnit?: ExpectationStatement["toleranceUnit"];
  unit?: ExpectationStatement["unit"];
  basis?: ExpectationStatement["basis"];
  currencyBasis?: ExpectationStatement["currencyBasis"];
  revision?: ExpectationStatement["revision"];
  previousLow?: number;
  previousHigh?: number;
  previousPoint?: number;
}
export interface GoldDocument {
  ticker: string;
  cik: number;
  accessionNo: string;
  form: string;
  url: string;
  expectedGuidanceStatus: ExpectationResponse["guidanceStatus"];
  required: GoldStatement[];
}
export interface BenchmarkFile { benchmarkId: string; reviewMethod: string; documents: GoldDocument[] }
export interface ExtractionForBenchmark {
  accessionNo: string;
  guidanceStatus: ExpectationResponse["guidanceStatus"] | null;
  statements: ExpectationStatement[];
}
export interface BenchmarkIssue {
  accessionNo: string;
  code: "missing_result" | "status_mismatch" | "missing_statement" | "value_mismatch" | "evidence_mismatch";
  detail: string;
}

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const same = (a: number | null, b: number | undefined) => b === undefined || (a !== null && Math.abs(a - b) <= 1e-9);
const anyIncludes = (actual: string, accepted: string[]) => accepted.some((value) => norm(actual).includes(norm(value)));

function metadataMismatches(gold: GoldStatement, actual: ExpectationStatement): string[] {
  const issues: string[] = [];
  if ((gold.kind ?? "guidance") !== actual.kind) issues.push("kind");
  if (gold.metric !== actual.metric) issues.push("metric");
  if (!anyIncludes(actual.scopeRaw, gold.scopeAny)) issues.push("scope");
  if (!anyIncludes(actual.periodRaw, gold.periodAny)) issues.push("period");
  if (gold.qualifier !== actual.qualifier) issues.push("qualifier");
  if (gold.unit !== undefined && gold.unit !== actual.unit) issues.push("unit");
  if (gold.basis !== undefined && gold.basis !== actual.basis) issues.push("basis");
  if (gold.currencyBasis !== undefined && gold.currencyBasis !== actual.currencyBasis) issues.push("currencyBasis");
  if (gold.revision !== undefined && gold.revision !== actual.revision) issues.push("revision");
  return issues;
}
function valueMismatches(gold: GoldStatement, actual: ExpectationStatement): string[] {
  const issues: string[] = [];
  if (!same(actual.valueLow, gold.low)) issues.push(`valueLow expected ${gold.low}, got ${actual.valueLow}`);
  if (!same(actual.valueHigh, gold.high)) issues.push(`valueHigh expected ${gold.high}, got ${actual.valueHigh}`);
  if (!same(actual.valuePoint, gold.point)) issues.push(`valuePoint expected ${gold.point}, got ${actual.valuePoint}`);
  if (!same(actual.tolerance, gold.tolerance)) issues.push(`tolerance expected ${gold.tolerance}, got ${actual.tolerance}`);
  if (gold.toleranceUnit !== undefined && gold.toleranceUnit !== actual.toleranceUnit) issues.push("toleranceUnit");
  if (!same(actual.previousLow, gold.previousLow)) issues.push(`previousLow expected ${gold.previousLow}, got ${actual.previousLow}`);
  if (!same(actual.previousHigh, gold.previousHigh)) issues.push(`previousHigh expected ${gold.previousHigh}, got ${actual.previousHigh}`);
  if (!same(actual.previousPoint, gold.previousPoint)) issues.push(`previousPoint expected ${gold.previousPoint}, got ${actual.previousPoint}`);
  return issues;
}

export function evaluateExpectationBenchmark(
  benchmark: BenchmarkFile,
  extractions: Map<string, ExtractionForBenchmark>,
  sourceTexts: Map<string, string> = new Map(),
) {
  const issues: BenchmarkIssue[] = [];
  let requiredStatements = 0, matchedStatements = 0, extraStatements = 0;
  for (const doc of benchmark.documents) {
    const extraction = extractions.get(doc.accessionNo);
    if (!extraction) {
      issues.push({ accessionNo: doc.accessionNo, code: "missing_result", detail: `${doc.ticker} ${doc.form} has no extraction result` });
      requiredStatements += doc.required.length;
      continue;
    }
    if (extraction.guidanceStatus !== doc.expectedGuidanceStatus) {
      issues.push({ accessionNo: doc.accessionNo, code: "status_mismatch", detail: `expected ${doc.expectedGuidanceStatus}, got ${extraction.guidanceStatus}` });
    }
    const source = sourceTexts.get(doc.accessionNo);
    if (source) {
      for (const statement of extraction.statements) {
        if (!evidenceInSource(statement.evidence, source)) {
          issues.push({ accessionNo: doc.accessionNo, code: "evidence_mismatch", detail: `${statement.metricRaw}: evidence is not contiguous source text` });
        }
      }
    }
    const used = new Set<number>();
    for (const gold of doc.required) {
      requiredStatements++;
      const candidates = extraction.statements
        .map((statement, index) => ({ statement, index, metadata: metadataMismatches(gold, statement) }))
        .filter((candidate) => candidate.metadata.length === 0 && !used.has(candidate.index));
      if (!candidates.length) {
        issues.push({ accessionNo: doc.accessionNo, code: "missing_statement", detail: `${gold.metric} · ${gold.scopeAny[0]} · ${gold.periodAny[0]}` });
        continue;
      }
      const ranked = candidates.map((candidate) => ({ ...candidate, values: valueMismatches(gold, candidate.statement) })).sort((a, b) => a.values.length - b.values.length);
      const best = ranked[0];
      if (best.values.length) {
        issues.push({ accessionNo: doc.accessionNo, code: "value_mismatch", detail: `${gold.metric} · ${best.values.join("; ")}` });
      } else {
        matchedStatements++;
        used.add(best.index);
      }
    }
    extraStatements += extraction.statements.length - used.size;
  }
  return {
    benchmarkId: benchmark.benchmarkId,
    reviewMethod: benchmark.reviewMethod,
    documents: benchmark.documents.length,
    documentsWithResults: benchmark.documents.filter((doc) => extractions.has(doc.accessionNo)).length,
    requiredStatements,
    matchedStatements,
    recall: requiredStatements ? matchedStatements / requiredStatements : null,
    extraStatementsForReview: extraStatements,
    issues,
    pass: issues.length === 0,
    note: "Required statements are a recall subset. Extra statements are queued for review, not automatically marked wrong.",
  };
}
