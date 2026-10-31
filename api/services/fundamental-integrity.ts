export type IntegritySeverity = "error" | "warning";
export type IntegrityIssueType =
  | "missing_availability" | "missing_unit" | "missing_period" | "invalid_period" | "irregular_duration"
  | "duplicate_fact" | "frame_conflict" | "unit_change" | "unit_conflict" | "continuity_gap"
  | "availability_inversion" | "duplicate_series_point" | "revision_outlier" | "duplicate_factor_point"
  | "factor_before_fact" | "missing_stage" | "count_inversion" | "coverage_gap" | "orphan_cik";
export interface IntegrityIssue { severity: IntegritySeverity; type: IntegrityIssueType; cik: number; concept?: string; periodEnd?: string; message: string; accessionNo?: string }
export interface FundamentalFactRow { id: number; cik: number; taxonomy: string; concept: string; unit: string; startDate: string | null; endDate: string | null; val: number | null; fy: number | null; fp: string | null; form: string | null; filed: string | null; accn: string | null }
export interface FundamentalSeriesRow { id: number; cik: number; concept: string; kind: "flow" | "stock"; periodEnd: string; vintage: "first" | "latest"; val: number | null; unit: string | null; derivation: "reported" | "derived_q4" | "derived_ytd"; sourceAccn: string | null; sourceFiled: string | null }
export interface FundamentalFactorRow { id: number; cik: number; factor: string; periodEnd: string; filedAt: string; value: number | null }
export interface FundamentalIntegritySummary { ciks: number; facts: number; series: number; factors: number; errors: number; warnings: number; duplicates: number; continuityGaps: number; availabilityInversions: number; coverageGaps: number; omittedIssues: number }
export interface FundamentalIntegrityReport { schemaVersion: 1; generatedAt: string; universeSha256: string; status: "pass" | "pass_with_warnings" | "fail"; summary: FundamentalIntegritySummary; issues: IntegrityIssue[] }
const DAY = 86_400_000;
const FLOW_CONCEPTS = new Set(["NetIncomeLoss", "NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInFinancingActivities", "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "CostOfGoodsAndServicesSold", "GrossProfit", "OperatingIncomeLoss", "EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "PaymentsOfDividendsCommonStock", "ShareBasedCompensation", "IncomeTaxExpenseBenefit", "DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet"]);
const REQUIRED_GROUPS: { name: string; concepts: (concept: string) => boolean }[] = [
  { name: "revenue", concepts: (c) => c.startsWith("RevenueFromContract") || c === "Revenues" || c === "SalesRevenueNet" },
  { name: "net_income", concepts: (c) => c === "NetIncomeLoss" },
  { name: "operating_cash_flow", concepts: (c) => c === "NetCashProvidedByUsedInOperatingActivities" },
  { name: "assets", concepts: (c) => c === "Assets" },
  { name: "equity", concepts: (c) => c === "StockholdersEquity" || c === "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest" },
  { name: "shares", concepts: (c) => c === "CommonStockSharesOutstanding" || c.startsWith("WeightedAverageNumberOf") },
  { name: "eps", concepts: (c) => c === "EarningsPerShareDiluted" || c === "EarningsPerShareBasicAndDiluted" },
  { name: "cash", concepts: (c) => c.startsWith("CashAndCashEquivalentsAtCarryingValue") },
  { name: "debt", concepts: (c) => c === "LongTermDebt" || c === "LongTermDebtNoncurrent" || c === "LongTermDebtAndCapitalLeaseObligations" },
];
function durationClass(startDate: string, endDate: string): "Q" | "H1" | "9M" | "FY" | "OTHER" {
  const days = (Date.parse(endDate) - Date.parse(startDate)) / DAY;
  if (days >= 70 && days <= 105) return "Q";
  if (days >= 150 && days <= 220) return "H1";
  if (days >= 240 && days <= 315) return "9M";
  if (days >= 330 && days <= 385) return "FY";
  return "OTHER";
}
function quarterIndex(periodEnd: string): number { const y = Number(periodEnd.slice(0, 4)), m = Number(periodEnd.slice(5, 7)); return y * 4 + Math.ceil(m / 3) - 1; }
function quarterLabel(index: number): string { return `${Math.floor(index / 4)}Q${(index % 4) + 1}`; }
function finiteDate(value: string | null): boolean { return !!value && Number.isFinite(Date.parse(value)); }
function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> { const out = new Map<string, T[]>(); for (const row of rows) { const key = keyOf(row); if (!out.has(key)) out.set(key, []); out.get(key)!.push(row); } return out; }
function revisionRatio(first: number, latest: number): number { return Math.abs(latest - first) / Math.max(Math.abs(first), 1e-9); }

export function auditFundamentalFacts(rows: FundamentalFactRow[]): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const add = (severity: IntegritySeverity, type: IntegrityIssueType, cik: number, concept: string, periodEnd: string | null, message: string, accessionNo?: string) => issues.push({ severity, type, cik: Number(cik), concept, ...(periodEnd ? { periodEnd } : {}), message, ...(accessionNo ? { accessionNo } : {}) });
  const exact = new Map<string, FundamentalFactRow>();
  const frame = new Map<string, FundamentalFactRow>();
  const unitPeriod = new Map<string, Set<string>>();
  for (const row of rows) {
    const periodKey = `${row.concept}|${row.startDate ?? ""}|${row.endDate ?? ""}`;
    if (!row.unit) add("error", "missing_unit", row.cik, row.concept, row.endDate, "Unit is empty; values cannot be compared", row.accn ?? undefined);
    if (!row.endDate || !finiteDate(row.endDate)) add("error", "missing_period", row.cik, row.concept, row.endDate, "periodEnd is missing or invalid", row.accn ?? undefined);
    if (!row.filed || !row.accn) add("error", "missing_availability", row.cik, row.concept, row.endDate, "filed/accession is required for point-in-time availability");
    if (row.startDate && !finiteDate(row.startDate)) add("error", "invalid_period", row.cik, row.concept, row.endDate, "startDate is invalid", row.accn ?? undefined);
    if (row.startDate && row.endDate && Date.parse(row.startDate) > Date.parse(row.endDate)) add("error", "invalid_period", row.cik, row.concept, row.endDate, "startDate is after periodEnd", row.accn ?? undefined);
    if (FLOW_CONCEPTS.has(row.concept) && !row.startDate) add("error", "missing_period", row.cik, row.concept, row.endDate, "Flow concept requires startDate for duration", row.accn ?? undefined);
    if (row.startDate && row.endDate && FLOW_CONCEPTS.has(row.concept) && durationClass(row.startDate, row.endDate) === "OTHER") add("warning", "irregular_duration", row.cik, row.concept, row.endDate, `Non-standard duration: ${row.startDate} → ${row.endDate}`, row.accn ?? undefined);
    if (row.endDate && row.filed && row.filed < row.endDate) add("error", "availability_inversion", row.cik, row.concept, row.endDate, `filed ${row.filed} precedes periodEnd ${row.endDate}`, row.accn ?? undefined);
    const exactKey = [row.cik, row.taxonomy, row.concept, row.unit, row.startDate, row.endDate, row.val, row.form, row.filed, row.accn].join("|");
    if (exact.has(exactKey)) add("error", "duplicate_fact", row.cik, row.concept, row.endDate, `Exact duplicate also appears as fact id ${exact.get(exactKey)!.id}`, row.accn ?? undefined);
    else exact.set(exactKey, row);
    const frameKey = `${row.accn}|${row.concept}|${row.unit}|${periodKey}`;
    const previous = frame.get(frameKey);
    if (previous && previous.val !== row.val) add("error", "frame_conflict", row.cik, row.concept, row.endDate, `Same accession carries different values ${previous.val} and ${row.val}`, row.accn ?? undefined);
    else frame.set(frameKey, row);
    if (!unitPeriod.has(periodKey)) unitPeriod.set(periodKey, new Set());
    unitPeriod.get(periodKey)!.add(row.unit);
    if (row.val !== null && !Number.isFinite(row.val)) add("error", "invalid_period", row.cik, row.concept, row.endDate, "Non-finite numeric value", row.accn ?? undefined);
  }
  for (const [key, units] of unitPeriod) {
    if (units.size > 1) {
      const [concept, startDate, endDate] = key.split("|");
      const cik = rows.find((row) => row.concept === concept && (row.startDate ?? "") === startDate && row.endDate === endDate)!.cik;
      add("error", "unit_conflict", Number(cik), concept, endDate, `Same concept/period has incompatible units: ${[...units].sort().join(", ")}`);
    }
  }
  for (const [cik, companyRows] of groupBy(rows, (row) => String(row.cik))) {
    for (const [concept, conceptRows] of groupBy(companyRows, (row) => row.concept)) {
      const units = new Set(conceptRows.map((row) => row.unit));
      if (units.size > 1) add("warning", "unit_change", Number(cik), concept, null, `Unit changes across history: ${[...units].sort().join(", ")}`);
      const periods = [...new Set(conceptRows.map((row) => row.endDate).filter((value): value is string => !!value))].sort();
      if (periods.length > 1) {
        const expected = quarterIndex(periods[periods.length - 1]) - quarterIndex(periods[0]);
        const missing = expected + 1 - periods.length;
        if (missing > 0) {
          const present = new Set(periods.map(quarterIndex));
          const gaps = Array.from({ length: expected + 1 }, (_, i) => quarterIndex(periods[0]) + i).filter((index) => !present.has(index)).slice(0, 8).map(quarterLabel);
          add("error", "continuity_gap", Number(cik), concept, periods[0], `${missing} missing quarters in expected grid: ${gaps.join(", ")}`);
        }
      }
    }
    for (const group of REQUIRED_GROUPS) {
      if (!companyRows.some((row) => group.concepts(row.concept))) add("warning", "coverage_gap", Number(cik), group.name, null, `No facts for required concept group ${group.name}`);
    }
  }
  return issues;
}

export function auditSeriesPoints(rows: FundamentalSeriesRow[]): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const add = (severity: IntegritySeverity, type: IntegrityIssueType, cik: number, concept: string, periodEnd: string | null, message: string, accessionNo?: string) => issues.push({ severity, type, cik: Number(cik), concept, ...(periodEnd ? { periodEnd } : {}), message, ...(accessionNo ? { accessionNo } : {}) });
  const unique = new Map<string, FundamentalSeriesRow>();
  for (const row of rows) {
    if (row.sourceFiled && row.sourceFiled < row.periodEnd) add("error", "availability_inversion", row.cik, row.concept, row.periodEnd, `sourceFiled ${row.sourceFiled} precedes periodEnd ${row.periodEnd}`, row.sourceAccn ?? undefined);
    if (row.val !== null && !Number.isFinite(row.val)) add("error", "invalid_period", row.cik, row.concept, row.periodEnd, "Non-finite series value", row.sourceAccn ?? undefined);
    const key = `${row.cik}|${row.concept}|${row.kind}|${row.periodEnd}|${row.vintage}`;
    if (unique.has(key)) add("error", "duplicate_series_point", row.cik, row.concept, row.periodEnd, `Duplicate ${row.vintage} point also appears as id ${unique.get(key)!.id}`, row.sourceAccn ?? undefined);
    else unique.set(key, row);
  }
  for (const [cik, companyRows] of groupBy(rows, (row) => String(row.cik))) {
    for (const [concept, conceptRows] of groupBy(companyRows, (row) => row.concept)) {
      const units = new Set(conceptRows.map((row) => row.unit));
      if (units.size > 1) add("warning", "unit_change", Number(cik), concept, null, `Series unit changes across history: ${[...units].sort().join(", ")}`);
      const periods = [...new Set(conceptRows.map((row) => row.periodEnd))].sort();
      if (periods.length > 1) {
        const expected = quarterIndex(periods[periods.length - 1]) - quarterIndex(periods[0]);
        const missing = expected + 1 - periods.length;
        if (missing > 0) {
          const present = new Set(periods.map(quarterIndex));
          const gaps = Array.from({ length: expected + 1 }, (_, i) => quarterIndex(periods[0]) + i).filter((index) => !present.has(index)).slice(0, 8).map(quarterLabel);
          add("error", "continuity_gap", Number(cik), concept, periods[0], `${missing} missing quarters in canonical grid: ${gaps.join(", ")}`);
        }
      }
      for (const period of periods) {
        const vintages = conceptRows.filter((row) => row.periodEnd === period);
        const first = vintages.find((row) => row.vintage === "first"), latest = vintages.find((row) => row.vintage === "latest");
        if (first?.val !== null && first?.val !== undefined && latest?.val !== null && latest?.val !== undefined && first.val !== latest.val) {
          const ratio = revisionRatio(first.val, latest.val);
          const signFlip = Math.sign(first.val) !== Math.sign(latest.val) && first.val !== 0 && latest.val !== 0;
          if (ratio > 1 || signFlip) add("warning", "revision_outlier", Number(cik), concept, period, `Large revision: ${first.val} → ${latest.val}`, latest.sourceAccn ?? undefined);
        }
      }
    }
  }
  return issues;
}

export function auditFactorPoints(rows: FundamentalFactorRow[], facts: FundamentalFactRow[]): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const add = (severity: IntegritySeverity, type: IntegrityIssueType, cik: number, concept: string, periodEnd: string, message: string) => issues.push({ severity, type, cik: Number(cik), concept, periodEnd, message });
  const unique = new Map<string, FundamentalFactorRow>();
  const firstFiledByPeriod = new Map<string, string>();
  for (const fact of facts) {
    if (!fact.filed || !fact.endDate) continue;
    const key = `${fact.cik}|${fact.endDate}`;
    if (!firstFiledByPeriod.has(key) || fact.filed < firstFiledByPeriod.get(key)!) firstFiledByPeriod.set(key, fact.filed);
  }
  for (const row of rows) {
    if (row.filedAt < row.periodEnd) add("error", "availability_inversion", row.cik, row.factor, row.periodEnd, `Factor filedAt ${row.filedAt} precedes periodEnd ${row.periodEnd}`);
    if (row.value !== null && !Number.isFinite(row.value)) add("error", "invalid_period", row.cik, row.factor, row.periodEnd, "Non-finite factor value");
    const firstFact = firstFiledByPeriod.get(`${row.cik}|${row.periodEnd}`);
    if (firstFact && row.filedAt.slice(0, 10) < firstFact) add("error", "factor_before_fact", row.cik, row.factor, row.periodEnd, `Factor availability ${row.filedAt.slice(0, 10)} precedes first fact availability ${firstFact}`);
    const key = `${row.cik}|${row.factor}|${row.periodEnd}`;
    if (unique.has(key)) add("error", "duplicate_factor_point", row.cik, row.factor, row.periodEnd, `Duplicate factor point also appears as id ${unique.get(key)!.id}`);
    else unique.set(key, row);
  }
  return issues;
}

export function buildFundamentalIntegrityReport(params: {
  facts: FundamentalFactRow[];
  series: FundamentalSeriesRow[];
  factors: FundamentalFactorRow[];
  universeSha256: string;
  generatedAt: string;
  maxIssues?: number;
}): FundamentalIntegrityReport {
  const { facts, series, factors, universeSha256, generatedAt, maxIssues = 10_000 } = params;
  const ciks = new Set([...facts.map((row) => row.cik), ...series.map((row) => row.cik), ...factors.map((row) => row.cik)]);
  const issues = [...auditFundamentalFacts(facts), ...auditSeriesPoints(series), ...auditFactorPoints(factors, facts)];
  for (const cik of ciks) {
    const factCount = facts.filter((row) => row.cik === cik).length;
    const seriesCount = series.filter((row) => row.cik === cik).length;
    const factorCount = factors.filter((row) => row.cik === cik).length;
    if (factCount > 0 && seriesCount === 0) issues.push({ severity: "error", type: "missing_stage", cik, message: "Facts exist but canonical series are empty" });
    if (factCount > 0 && seriesCount > 0 && factorCount === 0) issues.push({ severity: "warning", type: "missing_stage", cik, message: "Canonical series exist but factor points are empty" });
    if (seriesCount > factCount * 2) issues.push({ severity: "error", type: "count_inversion", cik, message: `Series ${seriesCount} exceeds two vintage points per fact (${factCount * 2})` });
  }
  issues.sort((a, b) => a.severity.localeCompare(b.severity) || a.cik - b.cik || a.type.localeCompare(b.type) || (a.concept ?? "").localeCompare(b.concept ?? "") || (a.periodEnd ?? "").localeCompare(b.periodEnd ?? ""));
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  return {
    schemaVersion: 1, generatedAt, universeSha256,
    status: errors ? "fail" : warnings ? "pass_with_warnings" : "pass",
    summary: {
      ciks: ciks.size, facts: facts.length, series: series.length, factors: factors.length, errors, warnings,
      duplicates: issues.filter((issue) => ["duplicate_fact", "duplicate_series_point", "duplicate_factor_point"].includes(issue.type)).length,
      continuityGaps: issues.filter((issue) => issue.type === "continuity_gap").length,
      availabilityInversions: issues.filter((issue) => ["availability_inversion", "factor_before_fact"].includes(issue.type)).length,
      coverageGaps: issues.filter((issue) => issue.type === "coverage_gap").length,
      omittedIssues: Math.max(0, issues.length - maxIssues),
    },
    issues: issues.slice(0, maxIssues),
  };
}
