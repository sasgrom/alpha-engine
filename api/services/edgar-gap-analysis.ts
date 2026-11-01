import type { FundamentalIntegrityReport, IntegrityIssueType } from "./fundamental-integrity";
export interface EdgarGapTypeSummary { type: IntegrityIssueType; count: number }
export interface EdgarGapCikSummary { cik: number; count: number; errors: number; warnings: number }
export interface EdgarContinuityGap { cik: number; concept: string; missingQuarters: string[]; firstMissingPeriod: string | null; lastMissingPeriod: string | null; recommendedAction: string }
export interface EdgarGapAnalysis {
  schemaVersion: 1;
  generatedAt: string;
  sourceGeneratedAt: string;
  since: string;
  summary: { errors: number; warnings: number; continuityIssues: number; continuityQuarters: number; excludedPre2000: number };
  byType: EdgarGapTypeSummary[];
  byCik: EdgarGapCikSummary[];
  byEra: { era: string; errors: number; warnings: number }[];
  gaps: EdgarContinuityGap[];
  omittedGaps: number;
}
const gapText = (message: string): string[] => {
  const match = message.match(/:\s*([^:]+)$/);
  return match ? match[1].split(",").map((value) => value.trim()).filter(Boolean) : [];
};
const eraOf = (periodEnd: string | undefined): string => !periodEnd ? "unknown" : periodEnd < "2010-01-01" ? "2000-2009" : periodEnd < "2020-01-01" ? "2010-2019" : periodEnd < "2025-01-01" ? "2020-2024" : "2025-2026";
const actionFor = (lastPeriod: string | null): string => lastPeriod && lastPeriod >= "2020-01-01"
  ? "Refresh EDGAR companyfacts and exhibits for the affected concept/period; preserve availability anchors."
  : "Historical gap only. Do not backfill with current-provider data unless the research window explicitly requires it.";

export function analyzeEdgarGaps(report: FundamentalIntegrityReport, generatedAt: string, since = "2000-01-01", maxGaps = 5000): EdgarGapAnalysis {
  const eligible = report.issues.filter((issue) => !issue.periodEnd || issue.periodEnd >= since);
  const excludedPre2000 = report.issues.length - eligible.length;
  const errors = eligible.filter((issue) => issue.severity === "error").length;
  const warnings = eligible.length - errors;
  const byType = [...new Set(eligible.map((issue) => issue.type))].sort().map((type) => ({ type, count: eligible.filter((issue) => issue.type === type).length }));
  const byCik = [...new Set(eligible.map((issue) => issue.cik))].sort((a, b) => a - b).map((cik) => ({
    cik, count: eligible.filter((issue) => issue.cik === cik).length,
    errors: eligible.filter((issue) => issue.cik === cik && issue.severity === "error").length,
    warnings: eligible.filter((issue) => issue.cik === cik && issue.severity === "warning").length,
  }));
  const byEra = ["2000-2009", "2010-2019", "2020-2024", "2025-2026", "unknown"].map((era) => ({
    era,
    errors: eligible.filter((issue) => eraOf(issue.periodEnd) === era && issue.severity === "error").length,
    warnings: eligible.filter((issue) => eraOf(issue.periodEnd) === era && issue.severity === "warning").length,
  }));
  const grouped = new Map<string, { quarters: Set<string>; first: string | null; last: string | null; cadenceExpected: boolean }>();
  for (const issue of eligible.filter((item) => item.type === "continuity_gap" || item.type === "cadence_expected_gap")) {
    const key = `${issue.cik}|${issue.concept}`;
    if (!grouped.has(key)) grouped.set(key, { quarters: new Set(), first: null, last: null, cadenceExpected: false });
    const entry = grouped.get(key)!;
    if (issue.type === "cadence_expected_gap") entry.cadenceExpected = true;
    for (const quarter of gapText(issue.message)) entry.quarters.add(quarter);
    if (issue.periodEnd && (!entry.first || issue.periodEnd < entry.first)) entry.first = issue.periodEnd;
    if (issue.periodEnd && (!entry.last || issue.periodEnd > entry.last)) entry.last = issue.periodEnd;
  }
  const gaps = [...grouped.entries()].map(([key, entry]) => {
    const [cikString, concept] = key.split("|");
    const missingQuarters = [...entry.quarters].sort();
    return {
      cik: Number(cikString), concept, missingQuarters,
      firstMissingPeriod: missingQuarters[0] ?? entry.first,
      lastMissingPeriod: missingQuarters[missingQuarters.length - 1] ?? entry.last,
      recommendedAction: entry.cadenceExpected
        ? "Annual-only disclosure cadence. Exclude from quarterly continuity errors and quarterly trend imputation."
        : actionFor(missingQuarters[missingQuarters.length - 1] ?? entry.last),
    };
  }).sort((a, b) => b.missingQuarters.length - a.missingQuarters.length || a.concept.localeCompare(b.concept) || a.cik - b.cik);
  return {
    schemaVersion: 1, generatedAt, sourceGeneratedAt: report.generatedAt, since,
    summary: {
      errors, warnings,
      continuityIssues: eligible.filter((issue) => issue.type === "continuity_gap").length,
      continuityQuarters: gaps.reduce((total, gap) => total + gap.missingQuarters.length, 0),
      excludedPre2000,
    },
    byType, byCik, byEra,
    gaps: gaps.slice(0, maxGaps),
    omittedGaps: Math.max(0, gaps.length - maxGaps),
  };
}
