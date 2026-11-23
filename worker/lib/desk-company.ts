/**
 * Turns one company's standard-fundamentals document (research standard, schema 2) into the compact statements file
 * the desk Company page reads. Pure: no file or database access here.
 *
 * Every figure is shown as the company first reported it, with the filing date and the XBRL tag it came from; when a
 * later filing printed a different figure for the same quarter, the latest one is carried beside it.
 *
 * Fiscal years and trailing years are built from four consecutive quarters, each figure as known when the last of
 * the four was first reported (the rule of the normalized panel, docs/engine/FUNDAMENTALS_NORMALIZATION.md):
 * flows are summed, weighted share counts averaged by days, per-share lines summed after every figure is moved to
 * the share basis of that last report. Share counts and per-share figures that are out of scale (a units slip in a
 * filing) are marked and enter none of these figures.
 */
import {
  DESK_COMPANY_SCHEMA_VERSION, type DeskCompanyActions, type DeskCompanyGuidance, type DeskCompanyStatements, type DeskGuidancePeriod, type DeskGuidanceUpdate,
  type DeskStatementCell, type DeskStatementKind, type DeskStatementName, type DeskStatementQuarter, type DeskStatementRow, type DeskStatementSum,
  type DeskStatementSumRow, type DeskStatementYear,
} from "../../contracts/desk-company";

export interface StandardField { code: string; statement: string; kind: string; meaning: string; unit?: string }
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

const DAY = 86_400_000;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
type OwnQuarter = { q: StandardQuarter; index: number };

const filedVersions = (versions: StandardVersion[] | undefined) =>
  (versions ?? []).filter((v) => typeof v[0] === "string" && Number.isFinite(v[1])).sort((a, b) => a[0].localeCompare(b[0]));

/** How a line's figures move with the share basis: a count grows with a split, a per-share figure shrinks. */
type ShareUnit = "count" | "perShare" | null;
const shareUnit = (field: StandardField): ShareUnit => (field.unit === "shares" || field.kind === "shares" ? "count" : field.unit === "USD/shares" || field.kind === "perShare" ? "perShare" : null);
interface ShareBases { at: (date: string) => number | null; today: number | null }

function cell(versions: StandardVersion[], sources: string[], unit: ShareUnit = null, bases?: ShareBases): DeskStatementCell | null {
  const filed = filedVersions(versions);
  if (!filed.length) return null;
  const first = filed[0], last = filed[filed.length - 1];
  const out: DeskStatementCell = { value: first[1], filed: first[0], source: sourceLabel(typeof first[2] === "number" ? sources[first[2]] : undefined) };
  let same = last[1] === first[1];
  if (unit && bases) {
    const from = bases.at(first[0]), to = bases.at(last[0]);
    // a later filing that only restates the figure for a split has not changed it
    if (!same && from !== null && to !== null && from !== to && first[1] !== 0) {
      const moved = unit === "count" ? (last[1] * from) / to : (last[1] * to) / from;
      same = Math.abs(moved / first[1] - 1) < 0.01;
    }
    if (bases.today !== null && from !== null && from !== bases.today) out.factor = bases.today / from;
  }
  if (!same) out.restated = { value: last[1], filed: last[0] };
  return out;
}

// --- share basis -------------------------------------------------------------------------------------------------------

/** A split from the standard prices: 4 is four shares for one, below 1 a reverse split. */
export interface StandardSplit { date: string; ratio: number }

/** A filing made up to this many days before a split takes effect may already show it (declared before, effective after). */
const SLIP_DAYS = 60;

/**
 * The share basis each of the company's own reports stands on: the product of the ratios of the splits it shows.
 * A report filed on or after a split's first day shows it. One filed up to 60 days before may show it too; its share
 * count settles that (it jumps by the ratio against the quarter before, or it does not). Null where that cannot be told.
 *
 * `shares` holds each quarter's weighted share count as that quarter's own report gave it (null when it gave none).
 */
export function shareBasis(own: Array<{ filed: string | null }>, shares: Array<number | null>, splits: StandardSplit[]): Array<number | null> {
  return own.map((quarter, i) => {
    if (!quarter.filed) return null;
    let basis = 1;
    for (const split of splits) {
      if (!(split.ratio > 0) || split.ratio === 1) continue;
      if (quarter.filed >= split.date) basis *= split.ratio;
      else if (daysApart(quarter.filed, split.date) <= SLIP_DAYS) {
        const now = shares[i], before = i > 0 ? shares[i - 1] : null;
        const expected = Math.abs(Math.log(split.ratio));
        if (!now || !before || now <= 0 || before <= 0 || expected < Math.log(1.1)) return null;
        const jump = Math.log(now / before) * Math.sign(Math.log(split.ratio));
        // in logs: within a quarter of the split's size of it, the count shows the split; within a quarter of no change, it does not
        if (Math.abs(jump - expected) < expected / 4) basis *= split.ratio;
        else if (Math.abs(jump) >= expected / 4) return null;
      }
    }
    return basis;
  });
}

// --- out-of-scale share counts and per-share figures ---------------------------------------------------------------------

/** Lines checked for scale: share counts and earnings per share. */
export const SCALE_CODES = ["sharesBasic", "shareswa", "shareswaDil", "eps", "epsDil"] as const;
export type ScaleCode = (typeof SCALE_CODES)[number];

/** One quarter's figures as its first report gave them; `basis` is that report's share basis. */
export interface ScaleQuarter {
  sharesBasic: number | null;
  shareswa: number | null;
  shareswaDil: number | null;
  /** Earnings per share; `Filed` is false for a figure the standard derived (net income / shares), which proves nothing about the shares. */
  eps: number | null;
  epsFiled: boolean;
  epsDil: number | null;
  epsDilFiled: boolean;
  /** Net income to common stockholders (else net income). */
  income: number | null;
  basis: number | null;
}

/** Two share estimates this close agree; a figure this far from the agreed count is a units slip, not a change. */
const SCALE_AGREE = 3, SCALE_OFF = 30;
const within = (a: number, b: number, factor: number) => a > 0 && b > 0 && a / b <= factor && b / a <= factor;
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

/**
 * Filings sometimes give a share count in thousands or millions, or a per-share figure in the wrong unit, and a figure
 * derived from such a count is wrong with it. Three estimates of the share count are set against each other per
 * quarter: the balance-sheet count, the weighted average, and net income / filed earnings per share. Two that agree
 * (within 3 times) give the quarter's count; a quarter without two takes the median of its nearest settled neighbours
 * (four each side, moved to its share basis). A share count 30 times or more off that count is marked, and so is an
 * earnings-per-share figure 30 times or more off net income / that count.
 */
export function scaleSuspects(quarters: ScaleQuarter[]): Array<Set<ScaleCode>> {
  const positive = (value: number | null): number | null => (value !== null && value > 0 ? value : null);
  const implied = (income: number | null, eps: number | null, filed: boolean): number | null =>
    filed && income !== null && eps !== null && Math.abs(eps) >= 0.05 && income / eps > 0 ? income / eps : null;
  const agreed: Array<number | null> = quarters.map((quarter) => {
    const basic = positive(quarter.sharesBasic);
    const weightedAll = [positive(quarter.shareswa), positive(quarter.shareswaDil)].filter((value): value is number => value !== null);
    const weighted = weightedAll.length === 2 ? (within(weightedAll[0], weightedAll[1], SCALE_AGREE) ? Math.sqrt(weightedAll[0] * weightedAll[1]) : null) : weightedAll[0] ?? null;
    const impliedAll = [implied(quarter.income, quarter.eps, quarter.epsFiled), implied(quarter.income, quarter.epsDil, quarter.epsDilFiled)].filter((value): value is number => value !== null);
    const fromEps = impliedAll.length === 2 ? (within(impliedAll[0], impliedAll[1], SCALE_AGREE) ? Math.sqrt(impliedAll[0] * impliedAll[1]) : null) : impliedAll[0] ?? null;
    for (const [a, b] of [[weighted, fromEps], [basic, fromEps], [basic, weighted]]) {
      if (a !== null && b !== null && within(a, b, SCALE_AGREE)) return Math.sqrt(a * b);
    }
    return null;
  });
  const count = quarters.map((quarter, k) => {
    if (agreed[k] !== null) return agreed[k];
    if (quarter.basis === null) return null;
    const near: number[] = [];
    for (const step of [-1, 1]) {
      let taken = 0;
      for (let j = k + step; j >= 0 && j < quarters.length && taken < 4; j += step) {
        const other = quarters[j].basis;
        if (agreed[j] === null || other === null) continue;
        near.push((agreed[j]! * quarter.basis) / other);
        taken++;
      }
    }
    return near.length ? median(near) : null;
  });
  return quarters.map((quarter, k) => {
    const out = new Set<ScaleCode>();
    const shares = count[k];
    for (const code of ["sharesBasic", "shareswa", "shareswaDil"] as const) {
      const value = quarter[code];
      if (value === null) continue;
      if (value <= 0 || (shares !== null && !within(value, shares, SCALE_OFF))) out.add(code);
    }
    if (shares !== null && quarter.income !== null) {
      const expected = Math.abs(quarter.income / shares);
      for (const code of ["eps", "epsDil"] as const) {
        const value = quarter[code];
        if (value === null) continue;
        const size = Math.abs(value);
        // below ten cents either way the comparison is rounding noise; a filed zero counts from fifty cents
        if (Math.max(size, expected) >= (size === 0 ? 0.5 : 0.1) && (size === 0 || expected === 0 || !within(size, expected, SCALE_OFF))) out.add(code);
      }
    }
    return out;
  });
}

// --- fiscal years and trailing years ------------------------------------------------------------------------------------

/** The four consecutive quarters ending at `at`, when they follow each other and span a year (350 to 380 days). */
function fourQuarters(own: OwnQuarter[], at: number): OwnQuarter[] | null {
  if (at < 3) return null;
  const four = own.slice(at - 3, at + 1);
  if (four.some((item) => !item.q.start)) return null;
  for (let k = 1; k < 4; k++) {
    if (Math.abs((Date.parse(four[k].q.start!) - Date.parse(four[k - 1].q.end)) / DAY - 1) > 7) return null;
  }
  const span = daysApart(four[0].q.start!, four[3].q.end);
  return span >= 350 && span <= 380 ? four : null;
}

/**
 * One line over four quarters. `asOf` is the filing date of the last quarter's own report: each quarter's figure is
 * the latest version filed by then. When one of the four was first filed later (the annual report restated the year
 * on a new basis, and the fourth quarter on that basis came with a later filing), all four are taken as known on the
 * day the last of them was first filed, so that one sum never mixes two bases; `filed` then carries that day.
 * `basisAt` gives the share basis of a filing date; it is used for share counts and per-share lines only.
 */
export function sumFourQuarters(params: {
  kind: DeskStatementKind;
  versions: Array<StandardVersion[] | undefined>;
  days: number[];
  asOf: string;
  basisAt: (date: string) => number | null;
  /** Today's share basis, to say how far the figure's own basis is from it. */
  today?: number | null;
}): DeskStatementSum | null {
  const { kind, days, basisAt } = params;
  if (kind === "instant") return null;
  const lists = params.versions.map((versions) => filedVersions(versions));
  if (lists.some((list) => !list.length)) return null;
  const asOf = lists.reduce((latest, list) => (list[0][0] > latest ? list[0][0] : latest), params.asOf);
  const target = kind === "flow" ? 1 : basisAt(asOf);
  if (target === null) return null;
  const totalDays = days.reduce((sum, value) => sum + value, 0);
  // a figure moved from its own filing's share basis to the basis of `asOf`
  const moved = (version: StandardVersion): number | null => {
    if (kind === "flow") return version[1];
    const from = basisAt(version[0]);
    if (from === null) return null;
    return kind === "shares" ? (version[1] * target) / from : (version[1] * from) / target;
  };
  let known = 0, latest: number | null = 0;
  const counts: number[] = [];
  for (let k = 0; k < 4; k++) {
    const all = lists[k];
    const value = moved([...all].reverse().find((version) => version[0] <= asOf)!);
    if (value === null) return null;
    const weight = kind === "shares" ? days[k] / totalDays : 1;
    known += value * weight;
    counts.push(value);
    const last = moved(all[all.length - 1]);
    latest = latest === null || last === null ? null : latest + last * weight;
  }
  // four share counts of one year on one basis stay within three times of each other; if not, one of them is not a count
  if (kind === "shares" && !(Math.min(...counts) > 0 && Math.max(...counts) / Math.min(...counts) <= SCALE_AGREE)) return null;
  const round = (value: number) => (kind === "flow" ? value : kind === "shares" ? Math.round(value) : Math.round(value * 1e6) / 1e6);
  const out: DeskStatementSum = { value: round(known) };
  if (latest !== null && Math.abs(round(latest) - out.value) > Math.abs(out.value) * 1e-9) out.restated = round(latest);
  if (asOf > params.asOf) out.filed = asOf;
  if (kind !== "flow" && params.today != null && params.today !== target) out.factor = params.today / target;
  return out;
}

/**
 * Earnings per share of four quarters: net income to common stockholders / the average share count, which is how the
 * annual report forms it (checked against the filed annual figures; a sum of four quarters' figures is further off).
 */
function perShareRatio(income: DeskStatementSum | null | undefined, shares: DeskStatementSum | null | undefined): DeskStatementSum | null {
  if (!income || !shares || !(shares.value > 0)) return null;
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  const out: DeskStatementSum = { value: round(income.value / shares.value), ratio: true };
  const latest = round((income.restated ?? income.value) / (shares.restated ?? shares.value));
  if (latest !== out.value) out.restated = latest;
  const filed = [income.filed, shares.filed].filter((date): date is string => !!date).sort().at(-1);
  if (filed) out.filed = filed;
  if (shares.factor !== undefined) out.factor = shares.factor;
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
  /**
   * The company's splits from the standard prices, for the share basis of fiscal-year and trailing-year figures.
   * Null when they are not known (no standard price file): share counts and per-share lines then get no such figures.
   */
  splits?: StandardSplit[] | null;
}): DeskCompanyStatements {
  const { doc, fields, standard, standardGeneratedAt, builtAt } = params;
  const keep = params.quarters ?? 40;
  if (doc.schemaVersion !== 2) throw new Error(`Standard fundamentals schema ${String(doc.schemaVersion)} is not the expected 2 (company ${doc.cik})`);
  // The newest quarters that the company itself reported (comparison-only quarters at the start of a history are left out).
  const own: OwnQuarter[] = doc.quarters.map((q, index) => ({ q, index })).filter(({ q }) => q.form != null && OWN_FORMS.has(q.form));
  const from = Math.max(0, own.length - keep);
  const chosen = own.slice(from);
  const position = new Map(chosen.map(({ index }, column) => [index, column]));
  const quarters: DeskStatementQuarter[] = chosen.map(({ q }) => ({ end: q.end, fy: q.fy ?? null, fq: q.fq ?? null, form: q.form ?? null, filed: q.filed ?? null }));
  const versionsOf = (code: string) => new Map((doc.fields[code] ?? []).map(([quarterIndex, versions]) => [quarterIndex, versions]));

  // The share basis of every own report, from the splits and the weighted share count each report itself gave.
  const weighted = [versionsOf("shareswaDil"), versionsOf("shareswa")];
  const ownShares = own.map(({ q, index }) => {
    for (const versions of weighted) {
      const first = filedVersions(versions.get(index))[0];
      if (first && q.filed && first[0] <= q.filed) return first[1];
    }
    return null;
  });
  const splits = [...(params.splits ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const basis = shareBasis(own.map(({ q }) => ({ filed: q.filed ?? null })), ownShares, splits);
  const filings = own.map(({ q }, i) => ({ filed: q.filed ?? "", basis: basis[i] })).filter((item) => item.filed).sort((a, b) => a.filed.localeCompare(b.filed));
  const basisAt = (date: string): number | null => {
    if (params.splits === null) return null;
    if (!splits.length) return 1;
    let found: number | null = null;
    for (const filing of filings) {
      if (filing.filed > date) break;
      found = filing.basis;
    }
    return found;
  };
  // today's basis: every split of the standard prices applied
  const today = params.splits === null ? null : splits.reduce((product, split) => (split.ratio > 0 ? product * split.ratio : product), 1);
  const bases: ShareBases = { at: basisAt, today };

  // Share counts and per-share figures out of scale, per own quarter (first reports).
  const firstOf = (code: string) => { const map = versionsOf(code); return (index: number) => filedVersions(map.get(index))[0] ?? null; };
  const firsts = { sharesBasic: firstOf("sharesBasic"), shareswa: firstOf("shareswa"), shareswaDil: firstOf("shareswaDil"), eps: firstOf("eps"), epsDil: firstOf("epsDil"), common: firstOf("netIncComStock"), net: firstOf("netinc") };
  const tagged = (version: StandardVersion | null) => version !== null && typeof version[2] === "number" && sourceLabel(doc.sources[version[2]]) !== "derived";
  const suspects = scaleSuspects(own.map(({ index }, i) => ({
    sharesBasic: firsts.sharesBasic(index)?.[1] ?? null, shareswa: firsts.shareswa(index)?.[1] ?? null, shareswaDil: firsts.shareswaDil(index)?.[1] ?? null,
    eps: firsts.eps(index)?.[1] ?? null, epsFiled: tagged(firsts.eps(index)), epsDil: firsts.epsDil(index)?.[1] ?? null, epsDilFiled: tagged(firsts.epsDil(index)),
    income: (firsts.common(index) ?? firsts.net(index))?.[1] ?? null, basis: params.splits === null ? null : basis[i],
  })));
  const suspectAt = new Map(own.map(({ index }, i) => [index, suspects[i]]));
  const isSuspect = (code: string, index: number) => suspectAt.get(index)?.has(code as ScaleCode) ?? false;

  // The windows: the year ending at each kept quarter, and the fiscal years (the quarters reported in an annual report).
  const windows = chosen.map((_, column) => {
    const four = fourQuarters(own, from + column);
    const asOf = four?.[3].q.filed ?? null;
    return four && asOf ? { four, asOf, days: four.map(({ q }) => daysApart(q.start!, q.end) + 1) } : null;
  });
  const years: DeskStatementYear[] = [];
  chosen.forEach(({ q }, column) => {
    if (q.form?.startsWith("10-K")) years.push({ end: q.end, fy: q.fy ?? null, filed: q.filed ?? null, quarter: column });
  });

  const statements: Record<DeskStatementName, DeskStatementRow[]> = { income: [], balance: [], cashflow: [] };
  const annual: Record<DeskStatementName, DeskStatementSumRow[]> = { income: [], balance: [], cashflow: [] };
  const trailing: Record<DeskStatementName, DeskStatementSumRow[]> = { income: [], balance: [], cashflow: [] };
  for (const field of fields) {
    if (!STATEMENTS.includes(field.statement as DeskStatementName) || !KINDS.includes(field.kind as DeskStatementKind)) continue;
    const statement = field.statement as DeskStatementName, kind = field.kind as DeskStatementKind;
    const versions = versionsOf(field.code);
    const cells: Array<DeskStatementCell | null> = chosen.map(() => null);
    for (const [quarterIndex, list] of versions) {
      const column = position.get(quarterIndex);
      if (column === undefined) continue;
      const value = cell(list, doc.sources, shareUnit(field), bases);
      if (value && isSuspect(field.code, quarterIndex)) value.suspect = true;
      cells[column] = value;
    }
    if (cells.every((value) => value === null)) continue;
    statements[statement].push({ code: field.code, label: field.meaning, kind, cells });
    if (kind === "instant") continue;
    const sums = windows.map((window) => (window && !window.four.some(({ index }) => isSuspect(field.code, index))
      ? sumFourQuarters({ kind, versions: window.four.map(({ index }) => versions.get(index)), days: window.days, asOf: window.asOf, basisAt, today })
      : null));
    trailing[statement].push({ code: field.code, cells: sums });
  }
  // Earnings per share of four quarters: net income to common / average shares where both are there, else the sum of the quarters.
  const trailingRow = (code: string) => trailing.income.find((row) => row.code === code);
  const common = trailingRow("netIncComStock");
  for (const [code, sharesCode] of [["eps", "shareswa"], ["epsDil", "shareswaDil"]]) {
    const row = trailingRow(code), shares = trailingRow(sharesCode);
    if (!row || !common || !shares) continue;
    row.cells = row.cells.map((sum, column) => (windows[column]?.four.some(({ index }) => isSuspect(code, index)) ? null : perShareRatio(common.cells[column], shares.cells[column]) ?? sum));
  }
  for (const statement of STATEMENTS) annual[statement] = trailing[statement].map((row) => ({ code: row.code, cells: years.map((year) => row.cells[year.quarter]) }));
  return { schemaVersion: DESK_COMPANY_SCHEMA_VERSION, cik: doc.cik, ticker: doc.ticker, name: doc.name, standard, standardGeneratedAt, builtAt, quarters, statements, years, annual, trailing };
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
