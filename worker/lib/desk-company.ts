/**
 * Turns one company's standard-fundamentals document (research standard, schema 2) into the compact statements file
 * the desk Company page reads. Pure: no file or database access here.
 *
 * Every figure is shown as the company first reported it, with the filing date and the XBRL tag it came from; when a
 * later filing printed a different figure for the same quarter, the latest one is carried beside it.
 */
import {
  DESK_COMPANY_SCHEMA_VERSION, type DeskCompanyActions, type DeskCompanyGuidance, type DeskCompanyStatements, type DeskGuidancePeriod, type DeskGuidanceUpdate,
  type DeskStatementCell, type DeskStatementKind, type DeskStatementName, type DeskStatementQuarter, type DeskStatementRow,
} from "../../contracts/desk-company";

export interface StandardField { code: string; statement: string; kind: string; meaning: string }
export interface StandardQuarter { end: string; start?: string; fy?: number | null; fq?: number | null; filed?: string | null; form?: string | null }
/** [filing date, value, index into `sources`] */
export type StandardVersion = [string, number, number?];
export interface StandardCompanyDoc {
  schemaVersion: number;
  cik: number;
  ticker: string;
  name: string;
  quarters: StandardQuarter[];
  sources: string[];
  fields: Record<string, Array<[number, StandardVersion[]]>>;
}

const STATEMENTS: DeskStatementName[] = ["income", "balance", "cashflow"];
const KINDS: DeskStatementKind[] = ["flow", "instant", "shares", "perShare"];
const OWN_FORMS = new Set(["10-Q", "10-K", "10-QT", "10-KT", "10-Q/A", "10-K/A"]);

/**
 * "t:Revenues" -> "Revenues"; "y:Tag" (differenced from year-to-date figures) and "x:Tag" (scope rule) -> "Tag";
 * "d0:opex" and other derivations -> "derived".
 */
export function sourceLabel(source: string | undefined): string {
  if (!source) return "derived";
  const [prefix, name] = source.includes(":") ? [source.slice(0, source.indexOf(":")), source.slice(source.indexOf(":") + 1)] : ["", source];
  return (prefix === "t" || prefix === "y" || prefix === "x") && name ? name : "derived";
}

function cell(versions: StandardVersion[], sources: string[]): DeskStatementCell | null {
  const filed = versions.filter((v) => typeof v[0] === "string" && Number.isFinite(v[1])).sort((a, b) => a[0].localeCompare(b[0]));
  if (!filed.length) return null;
  const first = filed[0], last = filed[filed.length - 1];
  const out: DeskStatementCell = { value: first[1], filed: first[0], source: sourceLabel(typeof first[2] === "number" ? sources[first[2]] : undefined) };
  if (last[1] !== first[1]) out.restated = { value: last[1], filed: last[0] };
  return out;
}

export function buildDeskCompanyStatements(params: {
  doc: StandardCompanyDoc;
  fields: StandardField[];
  standard: string;
  standardGeneratedAt: string;
  builtAt: string;
  /** How many of the newest quarters to keep. */
  quarters?: number;
}): DeskCompanyStatements {
  const { doc, fields, standard, standardGeneratedAt, builtAt } = params;
  const keep = params.quarters ?? 20;
  if (doc.schemaVersion !== 2) throw new Error(`Standard fundamentals schema ${String(doc.schemaVersion)} is not the expected 2 (company ${doc.cik})`);
  // The newest quarters that the company itself reported (comparison-only quarters at the start of a history are left out).
  const own = doc.quarters.map((q, index) => ({ q, index })).filter(({ q }) => q.form != null && OWN_FORMS.has(q.form));
  const chosen = own.slice(-keep);
  const position = new Map(chosen.map(({ index }, column) => [index, column]));
  const quarters: DeskStatementQuarter[] = chosen.map(({ q }) => ({ end: q.end, fy: q.fy ?? null, fq: q.fq ?? null, form: q.form ?? null, filed: q.filed ?? null }));
  const statements: Record<DeskStatementName, DeskStatementRow[]> = { income: [], balance: [], cashflow: [] };
  for (const field of fields) {
    if (!STATEMENTS.includes(field.statement as DeskStatementName) || !KINDS.includes(field.kind as DeskStatementKind)) continue;
    const cells: Array<DeskStatementCell | null> = chosen.map(() => null);
    for (const [quarterIndex, versions] of doc.fields[field.code] ?? []) {
      const column = position.get(quarterIndex);
      if (column !== undefined) cells[column] = cell(versions, doc.sources);
    }
    if (cells.every((value) => value === null)) continue;
    statements[field.statement as DeskStatementName].push({ code: field.code, label: field.meaning, kind: field.kind as DeskStatementKind, cells });
  }
  return { schemaVersion: DESK_COMPANY_SCHEMA_VERSION, cik: doc.cik, ticker: doc.ticker, name: doc.name, standard, standardGeneratedAt, builtAt, quarters, statements };
}

// --- guidance history ------------------------------------------------------------------------------------------------

/** One row of the guidance standard's statements file (only the fields used here). */
export interface GuidanceStatementRow {
  cik: number;
  availableFrom: string | null;
  acceptedEt: string;
  metric: string;
  basis: string;
  periodKind: string;
  periodEnd: string | null;
  timing: string;
  duplicateOf: string | null;
  flags: string[];
  low: number | null;
  high: number | null;
  mid: number;
  unit: string;
}

const GUIDANCE_SCALE: Record<string, number> = { usd_millions: 1e6, usd_billions: 1e9, usd_per_share: 1 };
const NOT_GUIDANCE = new Set(["metric_conflict", "metric_unconfirmed", "unit_mismatch", "low_above_high"]);
const DAY = 86_400_000;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
/** Rows of one release for one period that differ by more than this are two different things, not one statement. */
const AMBIGUOUS = 0.1;
/** A reported figure further than this from the guided midpoint is another measure (a segment, another definition). */
const OTHER_MEANING = 0.5;

/** The guidance view of the standard: forward-looking, not a duplicate, measure and unit confirmed. */
export function isGuidanceRow(row: GuidanceStatementRow): boolean {
  return row.timing === "forward" && !row.duplicateOf && !row.flags.some((flag) => NOT_GUIDANCE.has(flag));
}

function firstReported(doc: StandardCompanyDoc, field: string, quarterIndex: number): { value: number; filed: string } | null {
  const entry = (doc.fields[field] ?? []).find(([index]) => index === quarterIndex);
  if (!entry) return null;
  const versions = entry[1].filter((v) => typeof v[0] === "string" && Number.isFinite(v[1])).sort((a, b) => a[0].localeCompare(b[0]));
  return versions.length ? { value: versions[0][1], filed: versions[0][0] } : null;
}

export function buildDeskCompanyGuidance(params: {
  doc: StandardCompanyDoc;
  rows: GuidanceStatementRow[];
  guidanceVersion: string;
  standard: string;
  builtAt: string;
  /** Periods ending more than this many years before the company's latest quarter are left out. */
  years?: number;
}): DeskCompanyGuidance {
  const { doc, guidanceVersion, standard, builtAt } = params;
  const all = doc.quarters.map((q, index) => ({ q, index }));
  const own = all.filter(({ q }) => q.form != null && OWN_FORMS.has(q.form));
  const lastOwn = own.at(-1)?.q.end ?? null;
  const cutoff = lastOwn ? new Date(Date.parse(lastOwn) - (params.years ?? 6) * 365.25 * DAY).toISOString().slice(0, 10) : "0000-00-00";
  // the company's own quarter for a guided period end: the nearest quarter end within ten days
  const quarterAt = (end: string) => {
    let best: { q: StandardQuarter; index: number } | null = null;
    for (const item of all) {
      if (daysApart(item.q.end, end) <= 10 && (!best || daysApart(item.q.end, end) < daysApart(best.q.end, end))) best = item;
    }
    return best;
  };
  const groups = new Map<string, { metric: "revenue" | "eps"; basis: DeskGuidancePeriod["basis"]; kind: "Q" | "FY"; periodEnd: string; byRelease: Map<string, GuidanceStatementRow[]> }>();
  for (const row of params.rows) {
    if (!isGuidanceRow(row) || !row.periodEnd || !row.availableFrom || !(row.unit in GUIDANCE_SCALE)) continue;
    if ((row.metric !== "revenue" && row.metric !== "eps") || (row.periodKind !== "Q" && row.periodKind !== "FY")) continue;
    if ((row.metric === "eps") !== (row.unit === "usd_per_share") || !Number.isFinite(row.mid) || row.mid === 0) continue;
    const periodEnd = quarterAt(row.periodEnd)?.q.end ?? row.periodEnd;
    if (periodEnd < cutoff) continue;
    // The basis matters for earnings per share (GAAP against adjusted). For revenue the label is noise: the same
    // series comes out as GAAP, adjusted or unlabelled from one release to the next, so revenue is one series.
    const basis = row.metric === "revenue" ? "unclear" : row.basis === "gaap" || row.basis === "non_gaap" ? row.basis : "unclear";
    const key = `${row.metric}|${basis}|${row.periodKind}|${periodEnd}`;
    const group = groups.get(key) ?? { metric: row.metric, basis, kind: row.periodKind, periodEnd, byRelease: new Map() };
    groups.set(key, group);
    const release = `${row.availableFrom}|${row.acceptedEt}`;
    group.byRelease.set(release, [...(group.byRelease.get(release) ?? []), row]);
  }
  const periods: DeskGuidancePeriod[] = [];
  for (const group of groups.values()) {
    const updates: DeskGuidanceUpdate[] = [];
    let reaffirmed = 0;
    for (const [release, rows] of [...group.byRelease].sort((a, b) => a[0].localeCompare(b[0]))) {
      const mids = rows.map((row) => row.mid * GUIDANCE_SCALE[row.unit]);
      const lowest = Math.min(...mids), highest = Math.max(...mids);
      if ((highest - lowest) / Math.abs(lowest) > AMBIGUOUS) continue;
      const sorted = [...mids].sort((a, b) => a - b);
      const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      const lows = rows.filter((row) => row.low !== null).map((row) => row.low! * GUIDANCE_SCALE[row.unit]);
      const highs = rows.filter((row) => row.high !== null).map((row) => row.high! * GUIDANCE_SCALE[row.unit]);
      const update: DeskGuidanceUpdate = { issued: release.slice(0, 10), low: lows.length ? Math.min(...lows) : null, high: highs.length ? Math.max(...highs) : null, mid };
      const previous = updates.at(-1);
      if (previous && previous.mid === update.mid && previous.low === update.low && previous.high === update.high) reaffirmed++;
      else updates.push(update);
    }
    if (!updates.length) continue;
    const quarter = quarterAt(group.periodEnd);
    const reportedOwn = quarter !== null && quarter.q.form != null && OWN_FORMS.has(quarter.q.form);
    let actual: DeskGuidancePeriod["actual"] = null;
    let note: DeskGuidancePeriod["note"] = null;
    if (!reportedOwn) note = lastOwn !== null && group.periodEnd > lastOwn ? "not_reported_yet" : "not_in_standard";
    else if (group.metric === "eps" && group.basis !== "gaap") note = group.basis === "non_gaap" ? "adjusted_basis" : "not_in_standard";
    else if (group.kind === "Q") {
      const first = firstReported(doc, group.metric === "revenue" ? "revenue" : "epsDil", quarter!.index);
      if (first) actual = { ...first, how: "quarter" };
      else note = "not_in_standard";
    } else if (group.metric === "revenue") {
      // a fiscal year's revenue: the four quarters ending with the year's last, each as first reported
      const at = own.findIndex((item) => item.index === quarter!.index);
      const four = at >= 3 ? own.slice(at - 3, at + 1) : [];
      const values = four.map((item) => firstReported(doc, "revenue", item.index));
      const span = four.length === 4 ? daysApart(four[0].q.start ?? four[0].q.end, four[3].q.end) : 0;
      if (values.length === 4 && values.every((value) => value !== null) && span > 350 && span < 380) {
        actual = { value: values.reduce((sum, value) => sum + value!.value, 0), filed: values[3]!.filed, how: "four_quarters" };
      } else note = "not_in_standard";
    } else note = "not_in_standard";
    if (actual && Math.abs(actual.value / updates.at(-1)!.mid - 1) > OTHER_MEANING) {
      actual = null;
      note = "other_meaning";
    }
    periods.push({
      metric: group.metric, basis: group.basis, kind: group.kind, periodEnd: group.periodEnd, fy: quarter?.q.fy ?? null,
      fq: group.kind === "Q" ? quarter?.q.fq ?? null : null, updates, reaffirmed, actual, note,
    });
  }
  periods.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.metric.localeCompare(b.metric) || a.kind.localeCompare(b.kind) || a.basis.localeCompare(b.basis));
  return { schemaVersion: DESK_COMPANY_SCHEMA_VERSION, cik: doc.cik, ticker: doc.ticker, guidanceVersion, standard, builtAt, periods };
}

// --- splits and dividends --------------------------------------------------------------------------------------------

/** One session of a standard price file (only the fields used here; empty cells are empty strings). */
export interface StandardPriceRow { date: string; close: string; dividend: string; splitRatio: string; distribution: string }

export function buildDeskCompanyActions(params: { cik: number; ticker: string; rows: StandardPriceRow[]; builtAt: string; dividendYears?: number }): DeskCompanyActions | null {
  const rows = params.rows.filter((row) => row.date && Number(row.close) > 0);
  const last = rows.at(-1);
  if (!last) return null;
  const amount = (text: string) => (text === "" ? 0 : Number(text));
  const since = new Date(Date.parse(last.date) - (params.dividendYears ?? 10) * 365.25 * DAY).toISOString().slice(0, 10);
  const yearAgo = new Date(Date.parse(last.date) - 365 * DAY).toISOString().slice(0, 10);
  const splits: DeskCompanyActions["splits"] = [];
  const distributions: DeskCompanyActions["distributions"] = [];
  const dividends: DeskCompanyActions["dividends"] = [];
  let dividendsLastYear = 0;
  for (const row of rows) {
    const split = amount(row.splitRatio), factor = amount(row.distribution), dividend = amount(row.dividend);
    if (split > 0 && split !== 1) splits.push({ date: row.date, ratio: split });
    if (factor > 0 && factor !== 1) distributions.push({ date: row.date, factor });
    if (dividend > 0) {
      if (row.date >= since) dividends.push({ date: row.date, amount: dividend });
      if (row.date > yearAgo) dividendsLastYear += dividend;
    }
  }
  return {
    schemaVersion: DESK_COMPANY_SCHEMA_VERSION, cik: params.cik, ticker: params.ticker, pricesAsOf: last.date, lastClose: Number(last.close),
    splits: splits.reverse(), distributions: distributions.reverse(), dividends: dividends.reverse(),
    dividendsLastYear: Math.round(dividendsLastYear * 1e6) / 1e6, builtAt: params.builtAt,
  };
}
