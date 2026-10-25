/**
 * Pure 13F read-side safeguards. No DB, no collector state, no writes.
 * Quarter eligibility, fund coverage, and flow comparability are deliberately
 * separate concepts; none of them alone proves historical completeness.
 */
export const FILING_DELAY_DAYS = 45;
export const MIN_QUARTER_COVERAGE = 0.80;
export const PARTIAL_COVERAGE = 0.95;
export const MIN_BOOK_COUNT_RATIO = 0.25;

export interface QuarterCoverage { quarterDate: string; funds: number }
export interface QuarterSelection {
  cur: string;
  prev: string | null;
  expectedFunds: number;
  curFunds: number;
  skippedLatestQuarter: string | null;
  partial: boolean;
  warnings: string[];
}

export interface FundQuarterCount { fundCik: number; quarterDate: string; positions: number }
export interface ComparableFunds { stable: number[]; missing: number[]; suspect: number[] }

export interface GuardMeta extends QuarterSelection {
  stableFunds: number;
  missingFunds: number;
  suspectFunds: number;
}

function plusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
}

export function filingDeadline(quarterDate: string): string {
  return plusDays(quarterDate, FILING_DELAY_DAYS);
}

/** Select a usable current/previous pair. The latest early or severely
 * under-covered quarter is reported in metadata, never silently used for flows. */
export function selectQuarterPair(rows: QuarterCoverage[], asOf: string): QuarterSelection | null {
  const unique = new Map<string, number>();
  for (const row of rows) unique.set(row.quarterDate, Math.max(unique.get(row.quarterDate) ?? 0, row.funds));
  const all = [...unique.entries()].map(([quarterDate, funds]) => ({ quarterDate, funds }))
    .sort((a, b) => b.quarterDate.localeCompare(a.quarterDate));
  const eligible = all.filter((q) => q.funds > 0 && filingDeadline(q.quarterDate) < asOf);
  if (eligible.length === 0) return null;
  const expectedFunds = Math.max(...eligible.slice(0, 4).map((q) => q.funds));
  const minFunds = Math.max(2, Math.ceil(expectedFunds * MIN_QUARTER_COVERAGE));
  const usable = eligible.filter((q) => q.funds >= minFunds);
  const cur = usable[0];
  if (!cur) return null;
  const prev = usable.find((q) => q.quarterDate < cur.quarterDate) ?? null;
  const skippedLatestQuarter = all[0]?.quarterDate !== cur.quarterDate ? all[0]?.quarterDate ?? null : null;
  const partial = skippedLatestQuarter !== null || cur.funds < Math.ceil(expectedFunds * PARTIAL_COVERAGE);
  const warnings: string[] = [];
  if (skippedLatestQuarter) warnings.push(`Skipped ${skippedLatestQuarter}: filing window open or insufficient fund coverage.`);
  if (cur.funds < Math.ceil(expectedFunds * PARTIAL_COVERAGE)) warnings.push(`Quarter coverage: ${cur.funds}/${expectedFunds} tracked funds.`);
  if (!prev) warnings.push("No comparable previous quarter is available.");
  return {
    cur: cur.quarterDate,
    prev: prev?.quarterDate ?? null,
    expectedFunds,
    curFunds: cur.funds,
    skippedLatestQuarter,
    partial,
    warnings,
  };
}

/** Only funds present in both quarters may drive QoQ flows. Large book-count
 * discontinuities are treated as coverage anomalies, not trillion-dollar trades. */
export function comparableFunds(rows: FundQuarterCount[], cur: string, prev: string): ComparableFunds {
  const counts = new Map<string, number>();
  const fundIds = new Set<number>();
  for (const row of rows) {
    if (row.quarterDate !== cur && row.quarterDate !== prev) continue;
    fundIds.add(row.fundCik);
    const key = `${row.fundCik}|${row.quarterDate}`;
    counts.set(key, (counts.get(key) ?? 0) + row.positions);
  }
  const stable: number[] = [], missing: number[] = [], suspect: number[] = [];
  for (const fundCik of [...fundIds].sort((a, b) => a - b)) {
    const curN = counts.get(`${fundCik}|${cur}`) ?? 0;
    const prevN = counts.get(`${fundCik}|${prev}`) ?? 0;
    if (curN === 0 || prevN === 0) { missing.push(fundCik); continue; }
    const ratio = Math.min(curN, prevN) / Math.max(curN, prevN);
    if (Math.max(curN, prevN) >= 50 && ratio < MIN_BOOK_COUNT_RATIO) suspect.push(fundCik);
    else stable.push(fundCik);
  }
  return { stable, missing, suspect };
}

export function buildGuardMeta(selection: QuarterSelection, comparable: ComparableFunds): GuardMeta {
  const warnings = [...selection.warnings];
  if (comparable.missing.length > 0) warnings.push(`${comparable.missing.length} funds excluded because one quarter is missing.`);
  if (comparable.suspect.length > 0) warnings.push(`${comparable.suspect.length} funds excluded for book-count coverage anomalies.`);
  if (comparable.stable.length < 2) warnings.push("Insufficient comparable funds for flow calculations.");
  return {
    ...selection,
    stableFunds: comparable.stable.length,
    missingFunds: comparable.missing.length,
    suspectFunds: comparable.suspect.length,
    partial: selection.partial || comparable.stable.length < 2 || comparable.missing.length > 0 || comparable.suspect.length > 0,
    warnings,
  };
}
