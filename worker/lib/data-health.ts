import { isNonAdditiveQuarterlyConcept } from "../../api/services/series";

export type HealthSeverity = "info" | "review" | "quarantine";
export interface QuarantineEntry {
  source: string;
  key: string;
  check: string;
  severity: HealthSeverity;
  since: string;
  evidence: Record<string, unknown>;
}
export interface RatioPair {
  ticker: string;
  date: string;
  stooqClose: number;
  schwabClose: number;
}
export interface QuoteSpot {
  ticker: string;
  date: string;
  spot: number;
  schwabClose: number;
}
export interface HealthBar {
  ticker: string;
  source: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}
export interface FiledValue {
  concept: string;
  val: number;
  filed: string;
  accession: string;
  periodEnd: string;
  startDate?: string | null;
  unit?: string | null;
}

const entry = (
  source: string,
  key: string,
  check: string,
  severity: HealthSeverity,
  since: string,
  evidence: Record<string, unknown>
): QuarantineEntry => ({ source, key, check, severity, since, evidence });
const ratios = [1, 1.25, 1.5, 2, 3, 4, 5, 10, 20];
const ratioCandidates = [
  ...ratios,
  ...ratios.filter(value => value !== 1).map(value => 1 / value),
];

export function nearestHealthRatio(
  value: number,
  tolerance = 0.02
): { ratio: number; error: number } | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const match = ratioCandidates
    .map(candidate => ({
      candidate,
      error: Math.abs(value - candidate) / candidate,
    }))
    .sort((a, b) => a.error - b.error || a.candidate - b.candidate)[0];
  return match.error <= tolerance
    ? { ratio: match.candidate, error: match.error }
    : null;
}

export function priceRatioFindings(rows: RatioPair[]): QuarantineEntry[] {
  const findings: QuarantineEntry[] = [];
  const sorted = [...rows].sort(
    (a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date)
  );
  let previous: { ticker: string; date: string; ratio: number } | null = null;
  for (const row of sorted) {
    if (previous && previous.ticker !== row.ticker) previous = null;
    if (!(row.stooqClose > 0) || !(row.schwabClose > 0)) continue;
    const ratio = row.stooqClose / row.schwabClose;
    const reasons: string[] = [];
    if (ratio > 1.001) reasons.push("ratio_above_one");
    if (previous) {
      const step = ratio / previous.ratio - 1;
      if (step < -0.002) reasons.push("ratio_moves_away_from_present");
      if (Math.abs(step) > 0.15) reasons.push("step_above_15_percent");
    }
    if (reasons.length)
      findings.push(
        entry(
          "prices",
          `${row.ticker}|${row.date}`,
          "two_sources_one_story",
          "quarantine",
          row.date,
          {
            ratio,
            previousRatio: previous?.ratio ?? null,
            stooqClose: row.stooqClose,
            schwabClose: row.schwabClose,
            reasons,
          }
        )
      );
    previous = { ticker: row.ticker, date: row.date, ratio };
  }
  return findings;
}

export function quoteSplitFindings(rows: QuoteSpot[]): {
  splits: QuarantineEntry[];
  findings: QuarantineEntry[];
} {
  const splits: QuarantineEntry[] = [];
  const findings: QuarantineEntry[] = [];
  const sorted = [...rows].sort(
    (a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date)
  );
  let previous: { ticker: string; factor: number } | null = null;
  for (const row of sorted) {
    if (previous && previous.ticker !== row.ticker) previous = null;
    if (!(row.spot > 0) || !(row.schwabClose > 0)) continue;
    const rawFactor = row.spot / row.schwabClose;
    const nearest = nearestHealthRatio(rawFactor);
    if (!nearest || (nearest.ratio === 1 && Math.abs(rawFactor - 1) > 0.02)) {
      findings.push(
        entry(
          "options",
          `${row.ticker}|${row.date}`,
          "splits_from_quotes",
          "review",
          row.date,
          {
            rawFactor,
            spot: row.spot,
            schwabClose: row.schwabClose,
            reason: "unclean_cumulative_factor",
          }
        )
      );
      previous = { ticker: row.ticker, factor: rawFactor };
      continue;
    }
    const factor = nearest.ratio;
    if (previous) {
      const rawChange = previous.factor / factor;
      const change = nearestHealthRatio(rawChange);
      if (change && change.ratio !== 1) {
        const split = entry(
          "options",
          `${row.ticker}|${row.date}`,
          "splits_from_quotes",
          "info",
          row.date,
          {
            ratio: change.ratio,
            error: change.error,
            previousFactor: previous.factor,
            factor,
            spot: row.spot,
            schwabClose: row.schwabClose,
          }
        );
        splits.push(split);
      } else if (!change) {
        findings.push(
          entry(
            "options",
            `${row.ticker}|${row.date}`,
            "splits_from_quotes",
            "review",
            row.date,
            {
              rawFactor,
              previousFactor: previous.factor,
              factor,
              rawChange,
              reason: "unclean_factor_change",
            }
          )
        );
      }
    }
    previous = { ticker: row.ticker, factor };
  }
  return { splits, findings };
}

export function barFindings(
  rows: HealthBar[],
  corporateActionDates: ReadonlySet<string> = new Set()
): QuarantineEntry[] {
  const findings: QuarantineEntry[] = [];
  const sorted = [...rows].sort(
    (a, b) =>
      a.ticker.localeCompare(b.ticker) ||
      a.source.localeCompare(b.source) ||
      a.date.localeCompare(b.date)
  );
  let previous: HealthBar | null = null;
  let zeroRun: HealthBar[] = [];
  const flushZeroRun = () => {
    if (zeroRun.length >= 3)
      findings.push(
        entry(
          "prices",
          `${zeroRun[0].ticker}|${zeroRun[0].source}|${zeroRun[0].date}|${zeroRun.at(-1)!.date}`,
          "bars",
          "review",
          zeroRun.at(-1)!.date,
          {
            reason: "unchanged_ohlc_zero_volume",
            sessions: zeroRun.length,
            firstDate: zeroRun[0].date,
            lastDate: zeroRun.at(-1)!.date,
          }
        )
      );
    zeroRun = [];
  };
  for (const row of sorted) {
    if (
      !previous ||
      previous.ticker !== row.ticker ||
      previous.source !== row.source
    ) {
      flushZeroRun();
      previous = null;
    }
    const values = [row.open, row.high, row.low, row.close];
    if (values.some(value => value !== null && value <= 0))
      findings.push(
        entry(
          "prices",
          `${row.ticker}|${row.source}|${row.date}`,
          "bars",
          "quarantine",
          row.date,
          {
            reason: "non_positive_ohlc",
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
          }
        )
      );
    if (row.high !== null && row.low !== null && row.high < row.low)
      findings.push(
        entry(
          "prices",
          `${row.ticker}|${row.source}|${row.date}`,
          "bars",
          "quarantine",
          row.date,
          { reason: "high_below_low", high: row.high, low: row.low }
        )
      );
    if (
      previous &&
      previous.close !== null &&
      row.close !== null &&
      previous.close > 0
    ) {
      const move = row.close / previous.close - 1;
      if (
        Math.abs(move) > 0.5 &&
        !corporateActionDates.has(`${row.ticker}|${row.date}`)
      )
        findings.push(
          entry(
            "prices",
            `${row.ticker}|${row.source}|${row.date}`,
            "bars",
            "review",
            row.date,
            {
              reason: "one_day_move_above_50_percent",
              previousClose: previous.close,
              close: row.close,
              move,
            }
          )
        );
    }
    if (
      previous &&
      row.volume === 0 &&
      previous.volume === 0 &&
      row.open === previous.open &&
      row.high === previous.high &&
      row.low === previous.low &&
      row.close === previous.close
    )
      zeroRun.push(row);
    else {
      flushZeroRun();
      if (row.volume === 0) zeroRun = [row];
    }
    previous = row;
  }
  flushZeroRun();
  return findings;
}

export function gapEntries(
  ticker: string,
  source: string,
  dates: string[]
): QuarantineEntry[] {
  if (!dates.length) return [];
  return [
    entry("prices", `${ticker}|${source}`, "gaps", "review", dates.at(-1)!, {
      missingSessions: dates.length,
      dates,
      calendar: "SPY",
    }),
  ];
}

export function nonAdditiveEntry(row: {
  cik: number;
  concept: string;
  periodEnd: string;
  vintage: string;
  val: number | null;
  derivation: string;
  sourceAccn: string | null;
  sourceFiled: string | null;
}): QuarantineEntry | null {
  if (
    !isNonAdditiveQuarterlyConcept(row.concept) ||
    row.derivation === "reported"
  )
    return null;
  return entry(
    "series_points",
    `${row.cik}|${row.concept}|${row.periodEnd}|${row.vintage}`,
    "non_additive",
    "quarantine",
    row.sourceFiled ?? row.periodEnd,
    { value: row.val, derivation: row.derivation, accession: row.sourceAccn }
  );
}

export function unitScaleEntry(
  candidate: FiledValue,
  reference: FiledValue
): QuarantineEntry | null {
  if (
    !(candidate.val > 0) ||
    !(reference.val > 0) ||
    reference.filed > candidate.filed ||
    (reference.filed === candidate.filed &&
      reference.accession !== candidate.accession)
  )
    return null;
  const rawRatio = candidate.val / reference.val;
  for (const factor of [1000, 1000000, 0.001, 0.000001]) {
    const error = Math.abs(rawRatio / factor - 1);
    if (error <= 0.01)
      return entry(
        "facts",
        `${candidate.accession}|${candidate.concept}|${candidate.startDate ?? ""}|${candidate.periodEnd}`,
        "units_and_signs",
        "quarantine",
        candidate.filed,
        {
          originalValue: candidate.val,
          factor,
          error,
          reference,
          action: "reject_without_rescaling",
        }
      );
  }
  return null;
}

const negativeConcepts = new Set([
  "Assets",
  "CommonStockSharesOutstanding",
  "EntityCommonStockSharesOutstanding",
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
]);
export function negativeValueEntry(row: {
  cik: number;
  concept: string;
  periodEnd: string;
  vintage: string;
  val: number;
  sourceAccn: string | null;
  sourceFiled: string | null;
}): QuarantineEntry | null {
  if (!negativeConcepts.has(row.concept) || row.val >= 0) return null;
  return entry(
    "series_points",
    `${row.cik}|${row.concept}|${row.periodEnd}|${row.vintage}`,
    "units_and_signs",
    "quarantine",
    row.sourceFiled ?? row.periodEnd,
    { value: row.val, accession: row.sourceAccn, reason: "negative_value" }
  );
}

const incomeTotalConcepts = new Set([
  "NetIncomeLoss",
  "OperatingIncomeLoss",
  "GrossProfit",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "CostsAndExpenses",
  "OperatingExpenses",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
]);
export function restatementEntry(row: {
  cik: number;
  concept: string;
  periodEnd: string;
  first: number;
  latest: number;
  firstFiled: string | null;
  latestFiled: string | null;
  latestAccession: string | null;
}): QuarantineEntry | null {
  if (!incomeTotalConcepts.has(row.concept) || row.first === 0) return null;
  const change = (row.latest - row.first) / Math.abs(row.first);
  if (Math.abs(change) <= 0.1) return null;
  return entry(
    "series_points",
    `${row.cik}|${row.concept}|${row.periodEnd}`,
    "restatements",
    "info",
    row.latestFiled ?? row.periodEnd,
    {
      first: row.first,
      latest: row.latest,
      change,
      firstFiled: row.firstFiled,
      latestFiled: row.latestFiled,
      accession: row.latestAccession,
    }
  );
}

export function calendarFindings(checks: {
  outOfOrderNextPublications: any[];
  duplicateOriginalPeriods: any[];
}): QuarantineEntry[] {
  const outOfOrder = checks.outOfOrderNextPublications.map(row =>
    entry(
      "filings",
      `${row.cik}|${row.fiscalPeriodEnd}`,
      "calendar",
      "review",
      row.nextFirstPublicationCandidate,
      { ...row, reason: "out_of_order_next_publication" }
    )
  );
  const duplicates = checks.duplicateOriginalPeriods.flatMap(row =>
    row.duplicates.map((duplicate: any) =>
      entry(
        "filings",
        `${row.cik}|${duplicate.accessionNo}`,
        "calendar",
        "review",
        duplicate.acceptedUtc ?? duplicate.acceptedEt,
        {
          ...row,
          duplicates: undefined,
          duplicate,
          reason: "duplicate_original_period",
        }
      )
    )
  );
  return [...outOfOrder, ...duplicates];
}

export interface ExpectationHealthRow {
  cik: number;
  ticker: string;
  accessionNo: string;
  filingDate: string;
  updatedAt: string;
  status: string;
  rejectedEvidence: number;
  statements: unknown[];
  sourceFile: string;
}
export function expectationEvidenceFindings(
  rows: ExpectationHealthRow[]
): QuarantineEntry[] {
  return rows
    .filter(
      row => row.rejectedEvidence > 0 || row.status === "fallback_unverified"
    )
    .map(row =>
      entry(
        "expectations",
        `${row.cik}|${row.accessionNo}`,
        "expectation_evidence",
        "quarantine",
        row.updatedAt,
        {
          ticker: row.ticker,
          filingDate: row.filingDate,
          status: row.status,
          rejectedStatements: row.rejectedEvidence,
          acceptedStatements: row.statements.length,
          sourceFile: row.sourceFile.split(/[\\/]/).at(-1),
        }
      )
    );
}

export function expectationCompanyShares(
  rows: ExpectationHealthRow[]
): {
  cik: number;
  ticker: string;
  releases: number;
  rejectedReleases: number;
  rejectedStatements: number;
  acceptedStatements: number;
  rejectedShare: number;
}[] {
  const companies = new Map<number, ExpectationHealthRow[]>();
  for (const row of rows)
    companies.set(row.cik, [...(companies.get(row.cik) ?? []), row]);
  return [...companies.entries()]
    .map(([cik, values]) => {
      const rejectedStatements = values.reduce(
        (sum, row) => sum + row.rejectedEvidence,
        0
      );
      const acceptedStatements = values.reduce(
        (sum, row) => sum + row.statements.length,
        0
      );
      return {
        cik,
        ticker: values[0].ticker,
        releases: values.length,
        rejectedReleases: values.filter(
          row =>
            row.rejectedEvidence > 0 || row.status === "fallback_unverified"
        ).length,
        rejectedStatements,
        acceptedStatements,
        rejectedShare:
          rejectedStatements + acceptedStatements
            ? rejectedStatements / (rejectedStatements + acceptedStatements)
            : 0,
      };
    })
    .sort(
      (a, b) =>
        b.rejectedShare - a.rejectedShare || a.ticker.localeCompare(b.ticker)
    );
}

export function optionHealthFindings(row: {
  ticker: string;
  date: string;
  spot: number | null;
  spotSource: string | null;
  atmIv: number | null;
  atmStrike?: number | null;
}): QuarantineEntry[] {
  const findings: QuarantineEntry[] = [];
  if (
    row.spot === null ||
    row.spot <= 0 ||
    row.spotSource !== "put-call parity"
  )
    findings.push(
      entry(
        "options",
        `${row.ticker}|${row.date}`,
        "snapshot_health",
        "quarantine",
        row.date,
        {
          reason: "missing_quote_derived_spot",
          spot: row.spot,
          spotSource: row.spotSource,
        }
      )
    );
  if (row.atmIv === null || row.atmIv < 0.03 || row.atmIv > 4)
    findings.push(
      entry(
        "options",
        `${row.ticker}|${row.date}`,
        "snapshot_health",
        "quarantine",
        row.date,
        {
          reason: "atm_iv_outside_bounds",
          atmIv: row.atmIv,
          minimum: 0.03,
          maximum: 4,
        }
      )
    );
  if (
    row.atmStrike !== undefined &&
    row.spot !== null &&
    row.spot > 0 &&
    (row.atmStrike === null || Math.abs(row.atmStrike / row.spot - 1) > 0.05)
  )
    findings.push(
      entry(
        "options",
        `${row.ticker}|${row.date}`,
        "snapshot_health",
        "quarantine",
        row.date,
        {
          reason: "atm_strike_not_within_5_percent",
          atmStrike: row.atmStrike,
          spot: row.spot,
        }
      )
    );
  return findings;
}
