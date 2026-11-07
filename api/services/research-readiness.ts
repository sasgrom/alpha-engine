import type { PointRow, StatementRow, StatementsView } from "./statements";

export const RESEARCH_FACTOR_CONCEPTS = [
  "NetIncomeLoss", "ProfitLoss", "NetCashProvidedByUsedInOperatingActivities", "Assets", "GrossProfit",
  "StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  "CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding", "WeightedAverageNumberOfDilutedSharesOutstanding",
  "EarningsPerShareDiluted", "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
  "PaymentsToAcquirePropertyPlantAndEquipment", "OperatingIncomeLoss",
  "DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet",
  "LongTermDebt", "LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebtCurrent",
  "DebtCurrent", "ShortTermBorrowings", "CommercialPaper",
  "CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalentsAtCarryingValueIncludingRestrictedCash",
  "PaymentsOfDividendsCommonStock", "PaymentsOfDividends", "PaymentsOfDividendsMinorityInterest",
] as const;

export type FactorReadiness = "pilot_candidate" | "limited" | "insufficient_data" | "not_evaluated";

export function factorReadiness(input: { points: number; companies: number }): FactorReadiness {
  if (input.points === 0 || input.companies === 0) return "not_evaluated";
  if (input.companies >= 20 && input.points >= 400) return "pilot_candidate";
  if (input.companies >= 10 && input.points >= 100) return "limited";
  return "insufficient_data";
}

export interface StatementIssue { type: "net_debt_evidence" | "net_debt_mismatch" | "ttm_window" | "ttm_denominator" | "ttm_mismatch"; periodEnd: string; message: string }
export interface DerivedCoverage { nonNull: number; firstPeriod: string | null; lastPeriod: string | null }
export interface StatementAudit {
  issues: StatementIssue[];
  netDebt: DerivedCoverage;
  roeTtm: DerivedCoverage;
  roaTtm: DerivedCoverage;
}

const closeEnough = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const rowValue = (row: StatementRow | undefined, index: number) => row?.cells[index]?.v ?? null;
const quarterIndex = (periodEnd: string) => Number(periodEnd.slice(0, 4)) * 4 + Math.ceil(Number(periodEnd.slice(5, 7)) / 3) - 1;

function coverage(view: StatementsView, key: string): DerivedCoverage {
  const row = view.sections.flatMap((section) => section.rows).find((candidate) => candidate.key === key);
  if (!row) return { nonNull: 0, firstPeriod: null, lastPeriod: null };
  const periods = row.cells.map((cell, index) => cell.v === null ? null : view.periods[index]?.end ?? null).filter((value): value is string => Boolean(value)).sort();
  return { nonNull: periods.length, firstPeriod: periods[0] ?? null, lastPeriod: periods.at(-1) ?? null };
}

/** Independently recompute every populated derived cell and reject missing-evidence substitutions. */
export function auditStatementView(view: StatementsView, points: PointRow[]): StatementAudit {
  const rows = new Map(view.sections.flatMap((section) => section.rows).map((row) => [row.key, row]));
  const issues: StatementIssue[] = [];
  const latestPoint = (concept: string, periodEnd: string) => {
    const candidates = points.filter((point) => point.concept === concept && point.kind === "stock" && point.periodEnd === periodEnd && point.vintage === "latest" && point.val !== null);
    return candidates.at(-1)?.val ?? null;
  };
  for (const [index, period] of view.periods.entries()) {
    const netDebt = rowValue(rows.get("netDebt"), index);
    if (netDebt !== null) {
      const cash = rowValue(rows.get("cash"), index);
      const short = rowValue(rows.get("stDebt"), index);
      const noncurrent = latestPoint("LongTermDebtNoncurrent", period.end);
      const curated = latestPoint("LongTermDebt", period.end);
      if (cash === null) {
        issues.push({ type: "net_debt_evidence", periodEnd: period.end, message: "netDebt exists without cash evidence" });
      } else {
        const expected = short !== null && noncurrent !== null
          ? short + noncurrent - cash
          : curated !== null
            ? curated - cash
            : null;
        if (expected === null) {
          issues.push({ type: "net_debt_evidence", periodEnd: period.end, message: "netDebt exists without complete debt evidence" });
        } else if (!closeEnough(netDebt, expected)) {
          issues.push({ type: "net_debt_mismatch", periodEnd: period.end, message: `netDebt ${netDebt} != independent ${expected}` });
        }
      }
    }
    for (const [key, denominatorKey] of [["roeTtm", "equity"], ["roaTtm", "assets"]] as const) {
      const actual = rowValue(rows.get(key), index);
      if (actual === null) continue;
      const window = view.periods.slice(index, index + 4);
      const ni = rows.get("ni");
      const denominator = rowValue(rows.get(denominatorKey), index);
      if (window.length < 4 || window.some((period, offset) => offset > 0 && quarterIndex(window[offset - 1].end) - quarterIndex(period.end) !== 1) || window.some((_, offset) => rowValue(ni, index + offset) === null)) {
        issues.push({ type: "ttm_window", periodEnd: period.end, message: `${key} exists without four consecutive non-null NI quarters` });
        continue;
      }
      if (denominator === null || denominator === 0) {
        issues.push({ type: "ttm_denominator", periodEnd: period.end, message: `${key} has a null/zero denominator` });
        continue;
      }
      const sum = window.reduce((total, _, offset) => total + rowValue(ni, index + offset)!, 0);
      const expected = sum / denominator;
      if (!closeEnough(actual, expected)) issues.push({ type: "ttm_mismatch", periodEnd: period.end, message: `${key} ${actual} != independent ${expected}` });
    }
  }
  return { issues, netDebt: coverage(view, "netDebt"), roeTtm: coverage(view, "roeTtm"), roaTtm: coverage(view, "roaTtm") };
}
