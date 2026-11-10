/**
 * Form 4 insider-buy signal — UI-side domain logic (insider_buy_cluster_v1).
 *
 * Source discipline: SEC EDGAR ownership XML only. The point-in-time contract
 * mirrors the worker: eventTs = transactionDate, availableAt = SEC acceptance
 * time. Only open-market purchases (code P) count as signal; grants, option
 * exercises, tax withholding, gifts and sales are classified as excluded
 * noise with an explicit reason — never silently dropped, never counted.
 */

export interface Form4Owner {
  ownerCik: string | number | null;
  rptOwnerName: string;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  isOther: boolean;
  officerTitle: string | null;
  otherText: string | null;
}

export interface Form4Transaction {
  accessionNo: string;
  issuerCik: number;
  ticker: string;
  ownerName: string;
  ownerCik: string;
  isDirector: boolean;
  isOfficer: boolean;
  officerTitle: string | null;
  isTenPercentHolder: boolean;
  /** Filing-level flag: purchase under a pre-arranged 10b5-1 plan. */
  preplanned: boolean;
  securityTitle: string;
  /** eventTs — the day the trade happened. */
  transactionDate: string;
  transactionCode: string;
  equitySwapInvolved: boolean;
  acquiredDisposedCode: "A" | "D" | null;
  shares: number | null;
  pricePerShare: number | null;
  sharesOwnedAfter: number | null;
  directOrIndirect: "D" | "I" | null;
  natureOfOwnership: string | null;
  footnoteIds: string[];
  /** availableAt — SEC filing/acceptance date (never before transactionDate). */
  filingDate: string;
  sourceUrl: string;
  owners?: Form4Owner[];
  multiOwner?: boolean;
  exclusionReason?: string | null;
  clusterId?: string | null;
  availableAt?: string;
}

export type Form4Class =
  | { included: true; reason: "open_market_purchase" }
  | { included: false; reason: ExcludeReason };

export type ExcludeReason =
  | "sale"
  | "option_exercise"
  | "tax_withholding"
  | "grant_or_award"
  | "gift"
  | "equity_swap"
  | "other_code"
  | "not_acquisition"
  | "missing_amounts";

const CODE_REASON: Record<string, ExcludeReason> = {
  S: "sale",
  M: "option_exercise",
  F: "tax_withholding",
  A: "grant_or_award",
  G: "gift",
};

export const EXCLUDE_REASON_LABEL: Record<ExcludeReason, string> = {
  sale: "Sale — compensation or personal cash-flow, not a conviction signal",
  option_exercise: "Option exercise — compensation mechanics",
  tax_withholding: "Tax withholding on vesting — automatic",
  grant_or_award: "Grant/award — compensation, not own money",
  gift: "Gift or transfer — no market signal",
  equity_swap: "Equity swap involved — excluded by contract",
  other_code: "Non-purchase transaction code",
  not_acquisition: "Disposition, not an acquisition",
  missing_amounts: "Shares or price missing — not computable",
};

const EXPORT_REASON: Record<string, ExcludeReason> = {
  sale: "sale",
  option_exercise: "option_exercise",
  rsu_tax_withholding: "tax_withholding",
  award: "grant_or_award",
  gift: "gift",
  equity_swap: "equity_swap",
  unknown_equity_swap: "equity_swap",
  other_excluded: "other_code",
};

export function classifyTransaction(t: Form4Transaction): Form4Class {
  const exportedReason = t.exclusionReason ? EXPORT_REASON[t.exclusionReason] : undefined;
  if (exportedReason) return { included: false, reason: exportedReason };
  if (t.equitySwapInvolved) return { included: false, reason: "equity_swap" };
  if (t.transactionCode === "P") {
    if (t.acquiredDisposedCode !== "A") return { included: false, reason: "not_acquisition" };
    if (t.shares === null || t.pricePerShare === null) return { included: false, reason: "missing_amounts" };
    return { included: true, reason: "open_market_purchase" };
  }
  return { included: false, reason: CODE_REASON[t.transactionCode] ?? "other_code" };
}

export function transactionValueUsd(t: Form4Transaction): number | null {
  if (t.shares === null || t.pricePerShare === null) return null;
  return t.shares * t.pricePerShare;
}

export function filingLagDays(t: Form4Transaction): number | null {
  const a = Date.parse(t.transactionDate);
  const b = Date.parse(t.filingDate);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export type InsiderRole = "ceo" | "cfo" | "officer" | "director" | "ten_percent";

export function insiderRoles(t: Form4Transaction): InsiderRole[] {
  const roles: InsiderRole[] = [];
  const title = (t.officerTitle ?? "").toLowerCase();
  if (t.isOfficer && /\b(ceo|chief executive)\b/.test(title)) roles.push("ceo");
  if (t.isOfficer && /\b(cfo|chief financial)\b/.test(title)) roles.push("cfo");
  if (t.isOfficer && !roles.includes("ceo") && !roles.includes("cfo")) roles.push("officer");
  if (t.isDirector) roles.push("director");
  if (t.isTenPercentHolder) roles.push("ten_percent");
  return roles;
}

export interface InsiderCluster {
  clusterId?: string;
  ticker: string;
  windowStart: string;
  windowEnd: string;
  uniqueInsiders: number;
  hasCeo: boolean;
  hasCfo: boolean;
  hasDirector: boolean;
  hasTenPercent: boolean;
  allPreplanned: boolean;
  multiOwner?: boolean;
  aggregatePurchaseUsd: number;
  maxSinglePurchaseUsd: number;
  /** computed = every buy has value; partial = some buy missing amounts */
  status: "computed" | "partial";
  strength: "cluster" | "pair" | "single";
  transactions: Form4Transaction[];
}

export const CLUSTER_WINDOW_DAYS = 10;

/** Business-day-ish window: calendar days minus weekends, good enough for grouping. */
function withinWindow(a: string, b: string, days: number): boolean {
  return Math.abs(Date.parse(a) - Date.parse(b)) <= days * 86_400_000;
}

/**
 * Group open-market purchases per ticker into ≤CLUSTER_WINDOW_DAYS windows.
 * Input is pre-filtered to included buys. Three or more distinct insiders in
 * one window = cluster (the academically stronger signal), two = pair.
 */
export function buildClusters(buys: Form4Transaction[], windowDays = CLUSTER_WINDOW_DAYS): InsiderCluster[] {
  const byTicker = new Map<string, Form4Transaction[]>();
  for (const b of buys) {
    const rows = byTicker.get(b.ticker) ?? [];
    rows.push(b);
    byTicker.set(b.ticker, rows);
  }
  const clusters: InsiderCluster[] = [];
  for (const [ticker, rows] of byTicker) {
    const sorted = [...rows].sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
    let current: Form4Transaction[] = [];
    let anchor: string | null = null;
    const flush = () => {
      if (!current.length) return;
      const owners = new Set(current.map((t) => t.ownerCik));
      const roles = current.flatMap(insiderRoles);
      const values = current.map(transactionValueUsd);
      const known = values.filter((v): v is number => v !== null);
      const dates = current.map((t) => t.transactionDate).sort();
      clusters.push({
        ticker,
        windowStart: dates[0],
        windowEnd: dates[dates.length - 1],
        uniqueInsiders: owners.size,
        hasCeo: roles.includes("ceo"),
        hasCfo: roles.includes("cfo"),
        hasDirector: roles.includes("director"),
        hasTenPercent: roles.includes("ten_percent"),
        allPreplanned: current.every((t) => t.preplanned),
        aggregatePurchaseUsd: known.reduce((s, v) => s + v, 0),
        maxSinglePurchaseUsd: known.length ? Math.max(...known) : 0,
        status: known.length === current.length ? "computed" : "partial",
        strength: owners.size >= 3 ? "cluster" : owners.size === 2 ? "pair" : "single",
        transactions: current,
      });
      current = [];
      anchor = null;
    };
    for (const row of sorted) {
      if (anchor !== null && !withinWindow(anchor, row.transactionDate, windowDays)) flush();
      if (anchor === null) anchor = row.transactionDate;
      current.push(row);
    }
    flush();
  }
  return clusters.sort((a, b) => b.windowEnd.localeCompare(a.windowEnd) || b.aggregatePurchaseUsd - a.aggregatePurchaseUsd);
}
