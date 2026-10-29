export interface PipelineCounts {
  cik: number;
  facts: number;
  series: number;
  factors: number;
  prices: number;
  registered: boolean;
}
export interface ReconciliationIssue {
  severity: "error" | "warning";
  cik: number;
  type: "orphan" | "missing_stage" | "count_inversion" | "coverage";
  message: string;
}

function nonnegative(row: PipelineCounts): boolean {
  return [row.facts, row.series, row.factors, row.prices].every((n) => Number.isInteger(n) && n >= 0);
}

/** Structural facts → series → factors → prices reconciliation, no averaging away gaps. */
export function reconcilePipeline(rows: PipelineCounts[]): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
  for (const row of rows) {
    if (!nonnegative(row)) {
      issues.push({ severity: "error", cik: row.cik, type: "count_inversion", message: "Counts must be non-negative integers" });
      continue;
    }
    if (!row.registered) issues.push({ severity: "error", cik: row.cik, type: "orphan", message: "CIK is absent from the company registry" });
    // first/latest vintages may double raw facts; factor cardinality is independent.
    if (row.series > row.facts * 2) issues.push({ severity: "error", cik: row.cik, type: "count_inversion", message: `series ${row.series} exceeds two vintage points per fact (${row.facts * 2})` });
    if (row.facts === 0 && (row.series > 0 || row.factors > 0)) issues.push({ severity: "error", cik: row.cik, type: "orphan", message: "Derived rows exist without raw facts" });
    if (row.series === 0 && row.factors > 0) issues.push({ severity: "error", cik: row.cik, type: "orphan", message: "Factor rows exist without canonical series" });
    if (row.facts > 0 && row.series === 0) issues.push({ severity: "error", cik: row.cik, type: "missing_stage", message: "Facts exist but canonical series are empty" });
    if (row.series > 0 && row.factors === 0) issues.push({ severity: "warning", cik: row.cik, type: "missing_stage", message: "Canonical series exist but factor points are empty" });
    if (row.facts > 0 && row.prices === 0) issues.push({ severity: "warning", cik: row.cik, type: "coverage", message: "Fundamentals exist without price history" });
  }
  return issues;
}

export function orphanCiks(expected: number[], actual: number[]): number[] {
  const present = new Set(actual);
  return expected.filter((cik) => !present.has(cik)).sort((a, b) => a - b);
}
