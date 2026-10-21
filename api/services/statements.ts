/**
 * Statements view model (iteration 3e) — curated financial-statement rows
 * resolved from the canonical series layer (series_points), NOT from raw
 * XBRL directly. This is the backend for the Fundamentals tab viewer:
 * Tiingo-style statement tables, but with our native vintage control
 * (latest / first / as-of-T, decision D2) and fiscal-quarter labels that
 * respect each company's fiscalYearEnd (Apple ends Sep, NVIDIA Jan…).
 *
 * Row = curated line item with a candidate list of canonical concept names
 * (aliases already spliced by the series builder, so candidates are the
 * "newest" names). The first candidate with data in the visible grid wins —
 * the chosen concept is reported back for lineage/flag display.
 *
 * Derived rows (FCF, margins, ROE/ROA, net debt, current ratio) are
 * computed from the resolved base rows — never fetched from an external
 * source — and carry derived=true so the UI can mark them.
 */

export type VintageMode = "latest" | "first" | "asOf";
export type ViewMode = "quarterly" | "annual";

export interface PointRow {
  concept: string;
  kind: "flow" | "stock";
  periodEnd: string; // YYYY-MM-DD
  vintage: "first" | "latest";
  val: number | null;
  sourceFiled: string | null;
}

interface RowDef {
  key: string;
  label: string;
  indent: number;
  kind: "flow" | "stock";
  /** canonical concept candidates, first-with-data wins; empty for pure derivations */
  concepts: string[];
  /** derivative formula key (computed in a post-pass over resolved rows) */
  derive?:
    | "gp" // gross profit = revenue − costOfRevenue (fallback when GrossProfit is absent)
    | "fcf" // operating CF − capex
    | "netDebt" // (short-term debt + long-term debt) − cash
    | "grossMargin" | "opMargin" | "netMargin" | "fcfMargin" // x / revenue
    | "roeTtm" | "roaTtm" // ttm net income / equity / assets
    | "currentRatio"; // current assets / current liabilities
  unit: "money" | "shares" | "perShare" | "pct" | "x";
  /** display sign flip (e.g. capex reported positive, shown negative) */
  sign?: 1 | -1;
}

export interface StatementCell {
  v: number | null;
  /** annual flow column summed from fewer than 4 quarters (partial FY) */
  partial?: boolean;
}

export interface StatementRow {
  key: string;
  label: string;
  indent: number;
  unit: RowDef["unit"];
  derived: boolean;
  /** canonical concept actually used (null for pure derivations) */
  concept: string | null;
  /** all candidate concepts that supplied at least one cell (4f, D37) */
  usedConcepts: string[];
  /** series-health flags attached to the used concept, if any (debug) */
  flagged: boolean;
  /**
   * Honest discontinuation marker (4f): the last period with any value.
   * When the filer stopped tagging a concept (AAPL InterestExpense ends
   * 2023-07), the UI says "tag ended …" instead of a silently empty tail.
   */
  staleSince: string | null;
  cells: StatementCell[];
  /** YoY change as a fraction (0.05 = +5%), null when no prior-year cell */
  yoy: (number | null)[];
}

export interface StatementSection {
  key: string;
  title: string;
  rows: StatementRow[];
}

export interface StatementsView {
  periods: { end: string; label: string }[];
  sections: StatementSection[];
  vintageNote: string | null;
}

// ---------------------------------------------------------------------------
// Curated statement map
// ---------------------------------------------------------------------------

const BALANCE: RowDef[] = [
  { key: "cash", label: "Cash & cash equivalents", indent: 1, kind: "stock", concepts: ["CashAndCashEquivalentsAtCarryingValue"], unit: "money" },
  { key: "stInv", label: "Short-term investments", indent: 1, kind: "stock", concepts: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"], unit: "money" },
  { key: "ar", label: "Accounts receivable", indent: 1, kind: "stock", concepts: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"], unit: "money" },
  { key: "inv", label: "Inventory", indent: 1, kind: "stock", concepts: ["InventoryNet"], unit: "money" },
  { key: "ca", label: "Current assets", indent: 0, kind: "stock", concepts: ["AssetsCurrent"], unit: "money" },
  { key: "ppe", label: "Property, plant & equipment", indent: 1, kind: "stock", concepts: ["PropertyPlantAndEquipmentNet"], unit: "money" },
  { key: "gw", label: "Goodwill", indent: 1, kind: "stock", concepts: ["Goodwill"], unit: "money" },
  { key: "intang", label: "Intangible assets", indent: 1, kind: "stock", concepts: ["FiniteLivedIntangibleAssetsNet", "IntangibleAssetsNetExcludingGoodwill"], unit: "money" },
  { key: "assets", label: "Total assets", indent: 0, kind: "stock", concepts: ["Assets"], unit: "money" },
  { key: "ap", label: "Accounts payable", indent: 1, kind: "stock", concepts: ["AccountsPayableCurrent"], unit: "money" },
  { key: "stDebt", label: "Short-term debt", indent: 1, kind: "stock", concepts: ["ShortTermBorrowings", "CommercialPaper", "LongTermDebtCurrent"], unit: "money" },
  { key: "cl", label: "Current liabilities", indent: 0, kind: "stock", concepts: ["LiabilitiesCurrent"], unit: "money" },
  { key: "ltDebt", label: "Long-term debt", indent: 1, kind: "stock", concepts: ["LongTermDebtNoncurrent", "LongTermDebt"], unit: "money" },
  { key: "liab", label: "Total liabilities", indent: 0, kind: "stock", concepts: ["Liabilities"], unit: "money" },
  { key: "equity", label: "Stockholders' equity", indent: 0, kind: "stock", concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], unit: "money" },
  { key: "shares", label: "Shares outstanding", indent: 1, kind: "stock", concepts: ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"], unit: "shares" },
];

const INCOME: RowDef[] = [
  { key: "rev", label: "Revenue", indent: 0, kind: "flow", concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], unit: "money" },
  { key: "cost", label: "Cost of revenue", indent: 1, kind: "flow", concepts: ["CostOfGoodsAndServicesSold", "CostOfRevenue"], unit: "money" },
  { key: "gp", label: "Gross profit", indent: 0, kind: "flow", concepts: ["GrossProfit"], derive: "gp", unit: "money" },
  { key: "rd", label: "Research & development", indent: 1, kind: "flow", concepts: ["ResearchAndDevelopmentExpense"], unit: "money" },
  { key: "sga", label: "Selling, general & administrative", indent: 1, kind: "flow", concepts: ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"], unit: "money" },
  { key: "opex", label: "Operating expenses", indent: 1, kind: "flow", concepts: ["OperatingExpenses"], unit: "money" },
  { key: "opInc", label: "Operating income", indent: 0, kind: "flow", concepts: ["OperatingIncomeLoss"], unit: "money" },
  { key: "intExp", label: "Interest expense", indent: 1, kind: "flow", concepts: ["InterestExpense", "InterestExpenseNonoperating", "InterestIncomeExpenseNonoperatingNet", "InterestExpenseDebt"], unit: "money" },
  { key: "ebt", label: "Earnings before tax", indent: 1, kind: "flow", concepts: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"], unit: "money" },
  { key: "tax", label: "Tax expense", indent: 1, kind: "flow", concepts: ["IncomeTaxExpenseBenefit"], unit: "money" },
  { key: "ni", label: "Net income", indent: 0, kind: "flow", concepts: ["NetIncomeLoss", "ProfitLoss"], unit: "money" },
  { key: "epsDil", label: "EPS diluted", indent: 1, kind: "flow", concepts: ["EarningsPerShareDiluted"], unit: "perShare" },
  { key: "sharesDil", label: "Diluted shares (avg)", indent: 1, kind: "flow", concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding"], unit: "shares" },
];

const CASHFLOW: RowDef[] = [
  { key: "cfo", label: "Cash flow from operations", indent: 0, kind: "flow", concepts: ["NetCashProvidedByUsedInOperatingActivities"], unit: "money" },
  { key: "dna", label: "Depreciation & amortization", indent: 1, kind: "flow", concepts: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet"], unit: "money" },
  { key: "sbc", label: "Share-based compensation", indent: 1, kind: "flow", concepts: ["ShareBasedCompensation"], unit: "money" },
  { key: "cfi", label: "Cash flow from investing", indent: 0, kind: "flow", concepts: ["NetCashProvidedByUsedInInvestingActivities"], unit: "money" },
  { key: "capex", label: "Capital expenditure", indent: 1, kind: "flow", concepts: ["PaymentsToAcquirePropertyPlantAndEquipment"], sign: -1, unit: "money" },
  { key: "cff", label: "Cash flow from financing", indent: 0, kind: "flow", concepts: ["NetCashProvidedByUsedInFinancingActivities"], unit: "money" },
  { key: "div", label: "Dividends paid", indent: 1, kind: "flow", concepts: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends", "PaymentsOfDividendsMinorityInterest"], sign: -1, unit: "money" },
  { key: "buyback", label: "Share repurchases", indent: 1, kind: "flow", concepts: ["PaymentsForRepurchaseOfCommonStock"], sign: -1, unit: "money" },
  { key: "fcf", label: "Free cash flow", indent: 0, kind: "flow", concepts: [], derive: "fcf", unit: "money" },
];

const RATIOS: RowDef[] = [
  { key: "grossMargin", label: "Gross margin", indent: 0, kind: "flow", concepts: [], derive: "grossMargin", unit: "pct" },
  { key: "opMargin", label: "Operating margin", indent: 0, kind: "flow", concepts: [], derive: "opMargin", unit: "pct" },
  { key: "netMargin", label: "Net margin", indent: 0, kind: "flow", concepts: [], derive: "netMargin", unit: "pct" },
  { key: "fcfMargin", label: "FCF margin", indent: 0, kind: "flow", concepts: [], derive: "fcfMargin", unit: "pct" },
  { key: "roeTtm", label: "Return on equity (TTM)", indent: 0, kind: "flow", concepts: [], derive: "roeTtm", unit: "pct" },
  { key: "roaTtm", label: "Return on assets (TTM)", indent: 0, kind: "flow", concepts: [], derive: "roaTtm", unit: "pct" },
  { key: "netDebt", label: "Net debt", indent: 0, kind: "stock", concepts: [], derive: "netDebt", unit: "money" },
  { key: "currentRatio", label: "Current ratio", indent: 0, kind: "stock", concepts: [], derive: "currentRatio", unit: "x" },
];

export const STATEMENT_MAP: { key: string; title: string; rows: RowDef[] }[] = [
  { key: "income", title: "Income statement", rows: INCOME },
  { key: "balance", title: "Balance sheet", rows: BALANCE },
  { key: "cashflow", title: "Cash flow", rows: CASHFLOW },
  { key: "ratios", title: "Ratios & derivatives", rows: RATIOS },
];

/** Every concept the map may need — the router fetches exactly these. */
export const STATEMENT_CONCEPTS: string[] = [
  ...new Set(STATEMENT_MAP.flatMap((s) => s.rows.flatMap((r) => r.concepts))),
];

// ---------------------------------------------------------------------------
// Fiscal calendar helpers (fyEnd is SEC MMDD, e.g. "0926" for Apple)
// ---------------------------------------------------------------------------

/** Fiscal-quarter label for a period end, e.g. "FQ3 FY26". */
export function fiscalLabel(periodEnd: string, fyEnd: string | null): string {
  const y = Number(periodEnd.slice(0, 4));
  const m = Number(periodEnd.slice(5, 7));
  const fm = fyEnd && /^\d{4}$/.test(fyEnd) ? Number(fyEnd.slice(0, 2)) : 12;
  const fyYear = m > fm ? y + 1 : y;
  const fq = Math.floor(((m - fm - 1 + 12) % 12) / 3) + 1;
  return `FQ${fq} FY${String(fyYear).slice(2)}`;
}

/** Fiscal year a period end belongs to (year of the fiscal year END). */
function fiscalYearOf(periodEnd: string, fyEnd: string | null): number {
  const y = Number(periodEnd.slice(0, 4));
  const m = Number(periodEnd.slice(5, 7));
  const fm = fyEnd && /^\d{4}$/.test(fyEnd) ? Number(fyEnd.slice(0, 2)) : 12;
  return m > fm ? y + 1 : y;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Pick one vintage from the (at most two) stored rows of a cell. */
function pickVintage(rows: PointRow[], mode: VintageMode, asOf: string | null): PointRow | null {
  if (!rows.length) return null;
  const first = rows.find((r) => r.vintage === "first") ?? null;
  const latest = rows.find((r) => r.vintage === "latest") ?? null;
  if (mode === "first") return first;
  if (mode === "latest") return latest ?? first;
  // as-of(T): what was known on date T — latest only if filed by then
  const t = asOf ?? "9999-12-31";
  if (latest?.sourceFiled && latest.sourceFiled <= t) return latest;
  if (first?.sourceFiled && first.sourceFiled <= t) return first;
  return null;
}

interface ResolvedRow extends StatementRow {
  _kind: "flow" | "stock";
  _revisions: number;
}

/**
 * Build the statements view from raw series_points rows.
 * periods: quarterly grid = latest `n` quarter ends with real data;
 * annual grid = fiscal years (flows summed over 4 quarters, stocks at FY end).
 */
export function buildStatements(opts: {
  points: PointRow[];
  fyEnd: string | null;
  mode: ViewMode;
  vintage: VintageMode;
  asOf?: string | null;
  periods?: number;
  flaggedConcepts?: Set<string>;
}): StatementsView {
  const { points, fyEnd, mode, vintage } = opts;
  const asOf = opts.asOf ?? null;
  const flagged = opts.flaggedConcepts ?? new Set<string>();
  const nPeriods = opts.periods ?? (mode === "quarterly" ? 12 : 5);

  // cell lookup: concept|kind|periodEnd|vintage → row
  const cellMap = new Map<string, PointRow[]>();
  // period popularity: a grid period must carry a meaningful amount of data
  // (filters oddball monthly stock-only instants like share-count updates)
  const periodCounts = new Map<string, number>();
  for (const p of points) {
    const k = `${p.concept}|${p.kind}|${p.periodEnd}|${p.vintage}`;
    const arr = cellMap.get(k);
    if (arr) arr.push(p);
    else cellMap.set(k, [p]);
    periodCounts.set(p.periodEnd, (periodCounts.get(p.periodEnd) ?? 0) + 1);
  }

  const qGrid = [...periodCounts.entries()]
    .filter(([, n]) => n >= 8)
    .map(([pe]) => pe)
    .sort()
    .reverse()
    .slice(0, mode === "quarterly" ? nPeriods : nPeriods * 4 + 4);

  // For annual mode the visible grid is fiscal years; quarter ends that make
  // up each FY stay accessible for the aggregation below.
  const periods: { end: string; label: string; quarters: string[] }[] =
    mode === "quarterly"
      ? qGrid.map((pe) => ({ end: pe, label: fiscalLabel(pe, fyEnd), quarters: [pe] }))
      : (() => {
          const byFy = new Map<number, string[]>();
          for (const pe of qGrid) {
            const fy = fiscalYearOf(pe, fyEnd);
            const arr = byFy.get(fy);
            if (arr) arr.push(pe);
            else byFy.set(fy, [pe]);
          }
          return [...byFy.entries()]
            .sort((a, b) => b[0] - a[0])
            .slice(0, nPeriods)
            .map(([fy, quarters]) => ({
              end: quarters.sort().reverse()[0],
              label: `FY${String(fy).slice(2)}`,
              quarters,
            }));
        })();

  /** one (concept,kind) time series over the visible grid, vintage-resolved */
  function seriesFor(concept: string, kind: "flow" | "stock"): StatementCell[] {
    return periods.map((p) => {
      if (mode === "quarterly" || kind === "stock") {
        // quarterly: the quarter itself; annual stock: the FY-END quarter
        const pe = p.quarters[0];
        const rows: PointRow[] = [];
        for (const v of ["first", "latest"] as const) {
          const r = cellMap.get(`${concept}|${kind}|${pe}|${v}`);
          if (r) rows.push(...r);
        }
        const picked = pickVintage(rows, vintage, asOf);
        return { v: picked?.val ?? null };
      }
      // annual flow: sum the fiscal year's quarters; partial if fewer than 4
      let sum = 0;
      let have = 0;
      for (const pe of p.quarters) {
        const rows: PointRow[] = [];
        for (const v of ["first", "latest"] as const) {
          const r = cellMap.get(`${concept}|${kind}|${pe}|${v}`);
          if (r) rows.push(...r);
        }
        const picked = pickVintage(rows, vintage, asOf);
        if (picked?.val != null) {
          sum += picked.val;
          have++;
        }
      }
      if (have === 0) return { v: null };
      return have < 4 ? { v: sum, partial: true } : { v: sum };
    });
  }

  // --- pass 1: resolve base rows — PER-CELL candidate merge (4f, D37) -----
  // The owner's rule: enrich, don't scatter by source. Alternate concept
  // spellings of the same line item (discontinued tags, taxonomy renames)
  // merge into one continuous row: per period cell, the first candidate with
  // a value wins (candidate order = preference). Lineage stays honest via
  // usedConcepts + staleSince.
  const resolved = new Map<string, ResolvedRow>();
  for (const sec of STATEMENT_MAP) {
    for (const def of sec.rows) {
      const perCand = def.concepts.map((cand) => ({ cand, s: seriesFor(cand, def.kind) }));
      const usedConcepts = new Set<string>();
      let cells: StatementCell[] = periods.map((_, i) => {
        for (const { cand, s } of perCand) {
          if (s[i].v !== null) {
            usedConcepts.add(cand);
            return s[i];
          }
        }
        return { v: null as number | null };
      });
      // partial-year marks survive the merge (any contributing partial cell)
      cells = cells.map((c, i) => {
        if (c.partial) return c;
        for (const { s } of perCand) if (s[i].v !== null) return s[i].partial ? { ...c, partial: true } : c;
        return c;
      });
      const concept = perCand.find(({ s }) => s.some((c) => c.v !== null))?.cand ?? null;
      const sign = def.sign ?? 1;
      if (sign === -1) cells = cells.map((c) => ({ ...c, v: c.v == null ? null : -Math.abs(c.v) }));
      // honest discontinuation: no value in the two most recent periods while
      // older cells exist → the tag ended at the last non-null period
      let staleSince: string | null = null;
      const recentIdx = Math.min(1, periods.length - 1);
      const hasRecent = cells.slice(0, recentIdx + 1).some((c) => c.v !== null);
      if (!hasRecent) {
        const lastIdx = cells.findIndex((c) => c.v !== null);
        if (lastIdx > recentIdx) staleSince = periods[lastIdx].end;
      }
      // revision counter for the honest vintage note (first vs latest picks)
      let rowRevisions = 0;
      for (const { cand } of perCand) {
        for (const p of periods) {
          for (const pe of p.quarters) {
            const f = pickVintage(cellMap.get(`${cand}|${def.kind}|${pe}|first`) ?? [], "first", null);
            const l = pickVintage(cellMap.get(`${cand}|${def.kind}|${pe}|latest`) ?? [], "latest", null);
            if (f?.val != null && l?.val != null && f.val !== l.val) rowRevisions++;
          }
        }
      }
      resolved.set(def.key, {
        key: def.key,
        label: def.label,
        indent: def.indent,
        unit: def.unit,
        derived: false,
        concept,
        usedConcepts: [...usedConcepts],
        flagged: concept ? flagged.has(concept) : false,
        staleSince,
        cells,
        yoy: periods.map(() => null),
        _kind: def.kind,
        _revisions: rowRevisions,
      });
    }
  }

  // --- pass 2: derivations ------------------------------------------------
  const num = (key: string, i: number) => resolved.get(key)?.cells[i]?.v ?? null;
  const put = (key: string, fn: (i: number) => number | null) => {
    const row = resolved.get(key);
    if (!row) return;
    row.cells = periods.map((_, i) => ({ v: fn(i) }));
    row.derived = true;
    row.concept = row.concept; // keeps a fetched concept if the row had one
  };
  const div = (a: number | null, b: number | null) =>
    a == null || b == null || b === 0 ? null : a / b;

  put("gp", (i) => {
    const gp = num("gp", i);
    if (gp != null) return gp; // reported wins over the derived fallback
    const rev = num("rev", i);
    const cost = num("cost", i);
    return rev == null || cost == null ? null : rev - cost;
  });
  put("fcf", (i) => {
    const cfo = num("cfo", i);
    const capex = num("capex", i); // already sign-flipped (negative)
    // 3h review: a missing capex used to degrade FCF to bare CFO — silently
    // optimistic. No capex data → no FCF number (honesty over coverage).
    if (cfo == null || capex == null) return null;
    return cfo + capex;
  });
  put("netDebt", (i) => {
    const st = num("stDebt", i) ?? 0;
    const lt = num("ltDebt", i) ?? 0;
    const cash = num("cash", i);
    if (cash == null && st === 0 && lt === 0) return null;
    return st + lt - (cash ?? 0);
  });
  put("grossMargin", (i) => div(num("gp", i), num("rev", i)));
  put("opMargin", (i) => div(num("opInc", i), num("rev", i)));
  put("netMargin", (i) => div(num("ni", i), num("rev", i)));
  put("fcfMargin", (i) => div(num("fcf", i), num("rev", i)));
  put("currentRatio", (i) => div(num("ca", i), num("cl", i)));
  // TTM returns: quarterly = sum of the 4 latest quarters ending at i /
  // year-end balance; annual = the FY column itself (grid is desc: i+1..i+3
  // are the OLDER quarters)
  const ttm = (key: string, i: number): number | null => {
    const row = resolved.get(key);
    if (!row) return null;
    if (mode === "annual") return row.cells[i]?.v ?? null;
    let sum = 0;
    let have = 0;
    for (let j = i; j < Math.min(i + 4, periods.length); j++) {
      const v = row.cells[j]?.v;
      if (v != null) {
        sum += v;
        have++;
      }
    }
    return have === 4 ? sum : null;
  };
  put("roeTtm", (i) => div(ttm("ni", i), num("equity", i)));
  put("roaTtm", (i) => div(ttm("ni", i), num("assets", i)));

  // --- pass 3: YoY by CALENDAR alignment, not index offset ----------------
  // (3h review fix: an index offset (i+4 / i+1) silently misaligns when the
  // grid has a hole — a quarter below the 8-point popularity threshold drops
  // out and "4 positions back" stops being "one year back". Match periods by
  // quarter index / fiscal year instead; no same-period-last-year → null.)
  const qIdx = (pe: string) => {
    const y = Number(pe.slice(0, 4));
    const m = Number(pe.slice(5, 7));
    return y * 4 + (Math.ceil(m / 3) - 1);
  };
  const periodKey = periods.map((p) =>
    mode === "quarterly" ? qIdx(p.end) : fiscalYearOf(p.end, fyEnd)
  );
  const back = mode === "quarterly" ? 4 : 1;
  const byKey = new Map<number, number>(periodKey.map((k, i) => [k, i]));
  for (const row of resolved.values()) {
    row.yoy = periods.map((_, i) => {
      const j = byKey.get(periodKey[i] - back);
      const cur = row.cells[i]?.v;
      const prev = j === undefined ? null : row.cells[j]?.v;
      if (cur == null || prev == null || prev === 0) return null;
      // pct/x rows: show percentage-POINT (absolute) change, not relative
      return row.unit === "pct" || row.unit === "x" ? cur - prev : (cur - prev) / Math.abs(prev);
    });
  }

  const sections: StatementSection[] = STATEMENT_MAP.map((sec) => ({
    key: sec.key,
    title: sec.title,
    rows: sec.rows
      .map((d) => resolved.get(d.key)!)
      // drop rows with zero data across the whole grid (keeps the table tight)
      .filter((r) => r.cells.some((c) => c.v !== null))
      .map(({ _kind, _revisions, ...r }) => r),
  })).filter((s) => s.rows.length > 0);

  // honest vintage feedback (4f): switching to "first" and seeing identical
  // numbers means there were NO revisions in this window — say so instead of
  // letting the user diff two identical tables cell by cell
  const totalRevisions = [...resolved.values()].reduce((s, r) => s + r._revisions, 0);

  return {
    periods: periods.map(({ end, label }) => ({ end, label })),
    sections,
    vintageNote:
      vintage === "asOf"
        ? `as of ${asOf}: latest revision only when filed by that date — no lookahead${totalRevisions === 0 ? " · no revisions in this window" : ""}`
        : vintage === "first"
          ? totalRevisions === 0
            ? "as originally reported — no revisions in this window (first = latest)"
            : `first reported values — ${totalRevisions} cell(s) differ from latest`
          : null,
  };
}
