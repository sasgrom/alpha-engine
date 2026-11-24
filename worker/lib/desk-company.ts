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
  DESK_COMPANY_SCHEMA_VERSION, type DeskCompanyActions, type DeskCompanyFilings, type DeskCompanyGuidance, type DeskCompanyHolders, type DeskCompanyInsiders,
  type DeskCompanyStatements, type DeskScreenCompany,
  type DeskInsiderCompanyNet, type DeskInsiderMarket, type DeskInsiderMarketTrade, type DeskInsiderWindow,
  type DeskGuidancePeriod, type DeskGuidanceUpdate,
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

/** An adjusted earnings-per-share figure an earnings release printed for a period (scripts/build-adjusted-eps.mts), usable grades only. */
export interface AdjustedEpsActual { kind: "Q" | "FY"; periodEnd: string; value: number; released: string }

export function buildDeskCompanyGuidance(params: {
  doc: StandardCompanyDoc;
  rows: GuidanceStatementRow[];
  guidanceVersion: string;
  standard: string;
  builtAt: string;
  /** The company's reported adjusted earnings per share, and the version of that reading. */
  adjusted?: AdjustedEpsActual[];
  adjustedVersion?: string;
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
    // adjusted earnings per share: the figure the release for that period printed (the filed statements carry GAAP only)
    const printed = group.metric === "eps" && group.basis === "non_gaap"
      ? (params.adjusted ?? []).find((item) => item.kind === group.kind && daysApart(item.periodEnd, group.periodEnd) <= 10 && item.released > updates.at(-1)!.issued) ?? null
      : null;
    if (printed) actual = { value: printed.value, filed: printed.released, how: "release" };
    else if (!reportedOwn) note = lastOwn !== null && group.periodEnd > lastOwn ? "not_reported_yet" : "not_in_standard";
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
  return {
    schemaVersion: DESK_COMPANY_SCHEMA_VERSION, cik: doc.cik, ticker: doc.ticker, guidanceVersion, standard,
    ...(params.adjustedVersion && periods.some((period) => period.actual?.how === "release") ? { adjustedVersion: params.adjustedVersion } : {}), builtAt, periods,
  };
}

// --- splits and dividends --------------------------------------------------------------------------------------------

/** One session of a standard price file (only the fields used here; empty cells are empty strings). */
export interface StandardPriceRow { date: string; close: string; dividend: string; splitRatio: string; distribution: string; volume?: string }

/**
 * One company's row of the Screener's fundamentals: the four quarters ending at its last reported quarter, in the
 * latest filed figures (a screen asks what the company earns now, not what was known on a past day), with per-share
 * figures on today's share basis; and the mean dollar volume of the last 63 sessions.
 */
export function buildDeskScreenCompany(params: { statements: DeskCompanyStatements; prices: StandardPriceRow[] | null }): DeskScreenCompany | null {
  const { statements } = params;
  let at = statements.quarters.length - 1;
  while (at >= 0 && !statements.quarters[at].filed) at--;
  if (at < 0) return null;
  const year = (name: DeskStatementName, code: string, index: number): DeskStatementSum | null => (index < 0 ? null : statements.trailing[name].find((row) => row.code === code)?.cells[index] ?? null);
  const latest = (sum: DeskStatementSum | null): number | null => (sum ? sum.restated ?? sum.value : null);
  const netIncome = latest(year("income", "netIncComStock", at)) ?? latest(year("income", "netinc", at));
  const perShare = year("income", "epsDil", at);
  let epsDiluted = perShare ? latest(perShare)! / (perShare.factor ?? 1) : null;
  let epsHow: DeskScreenCompany["epsHow"] = epsDiluted === null ? null : "year";
  if (epsDiluted === null && netIncome !== null) {
    const shares = statements.statements.income.find((row) => row.code === "shareswaDil")?.cells[at];
    const count = shares && !shares.suspect ? (shares.restated?.value ?? shares.value) * (shares.factor ?? 1) : null;
    if (count !== null && count > 0) { epsDiluted = netIncome / count; epsHow = "last_shares"; }
  }
  // One quarter above three times each of the other three is no year of revenue: a full year's figure standing in a
  // quarter's place (L3Harris' fourth quarter of 2025 in v3.2). The year's revenue is then withheld, not shown.
  const quarterly = statements.statements.income.find((row) => row.code === "revenue")?.cells ?? [];
  const revenueOf = (end: number): number | null => {
    const four = quarterly.slice(Math.max(0, end - 3), end + 1).map((cell) => (cell ? cell.restated?.value ?? cell.value : null));
    const spike = four.some((value, index) => value !== null && value > 0 && four.every((other, at2) => at2 === index || (other !== null && other > 0 && value > 3 * other)));
    return spike ? null : latest(year("income", "revenue", end));
  };
  const sessions = (params.prices ?? []).filter((row) => Number(row.close) > 0 && Number(row.volume) > 0).slice(-63);
  const round = (value: number | null, digits: number) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);
  return {
    cik: statements.cik, ticker: statements.ticker, periodEnd: statements.quarters[at].end, filed: statements.quarters[at].filed,
    revenue: revenueOf(at), revenueYearAgo: revenueOf(at - 4),
    netIncome, freeCashFlow: latest(year("cashflow", "freeCashFlow", at)),
    epsDiluted: round(epsDiluted, 4), epsHow,
    // fewer than a month of sessions is no three-month average
    dollarVolume: sessions.length >= 21 ? Math.round(sessions.reduce((sum, row) => sum + Number(row.close) * Number(row.volume), 0) / sessions.length) : null,
  };
}

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

// --- holders: the 13F standard --------------------------------------------------------------------------------------------

/** One row of the 13F standard's company quarters (only the fields used here). */
export interface ThirteenFCompanyQuarter {
  cik: number;
  period: string;
  knownAt: string;
  /** "deadline": as known at the filing deadline; "plus_10": ten sessions later, with the late reports. */
  rowKind: string;
  holders: number;
  valueHeldUsd: number;
  /** In percent (57.4 = 57.4%). */
  percentOfSharesOutstanding: number | null;
  percentAbove100: boolean;
  continuingFunds: number | null;
  entries: number | null;
  exits: number | null;
  breadthChange: number | null;
  sharesBought: number | null;
  sharesSold: number | null;
  top10Share: number | null;
  fundsFiled: number;
  fundsInBook: number;
  buildVersion: string;
}

/** A company's last quarters of fund holdings: per quarter the later of the standard's two rows (the one with the late reports). */
export function buildDeskCompanyHolders(params: { cik: number; ticker: string; rows: ThirteenFCompanyQuarter[]; builtAt: string; quarters?: number }): DeskCompanyHolders | null {
  const byPeriod = new Map<string, ThirteenFCompanyQuarter>();
  for (const row of params.rows) {
    const held = byPeriod.get(row.period);
    if (!held || row.knownAt > held.knownAt) byPeriod.set(row.period, row);
  }
  const rows = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period)).slice(-(params.quarters ?? 20));
  if (!rows.length) return null;
  return {
    schemaVersion: DESK_COMPANY_SCHEMA_VERSION, cik: params.cik, ticker: params.ticker, version: rows[rows.length - 1].buildVersion, builtAt: params.builtAt,
    quarters: rows.map((row) => ({
      period: row.period, knownAt: row.knownAt, holders: row.holders, fundsFiled: row.fundsFiled, fundsInBook: row.fundsInBook, valueUsd: row.valueHeldUsd,
      shareOfStock: row.percentOfSharesOutstanding === null || row.percentAbove100 ? null : row.percentOfSharesOutstanding / 100,
      entries: row.entries, exits: row.exits, continuing: row.continuingFunds, breadthChange: row.breadthChange,
      sharesBought: row.sharesBought, sharesSold: row.sharesSold, top10Share: row.top10Share,
    })),
  };
}

// --- insiders: the insider standard -----------------------------------------------------------------------------------------

/** One filing of the insider standard's per-company file (only the fields used here). */
export interface InsiderFilingDoc {
  filing: { accessionNo: string; form: string; filingDate: string; buildVersion: string };
  owners: Array<{ ownerName: string; groupId: string; director: boolean; officer: boolean; officerTitle: string | null; tenPercentOwner: boolean }>;
  transactions: Array<{
    groupId: string; derivative: boolean; transactionDate: string | null; code: string | null; shares: number | null; price: number | null;
    valueUsd: number | null; plan10b5: boolean; duplicateOf: string | null; flags: string[];
    /** "D" held by the reporting person, "I" held through someone else (a company, a fund, a trust, a spouse). */
    directOrIndirect: string | null;
  }>;
}

/** The standard's consumer rule: a line with one of these flags has no usable dollar value. */
const NO_DOLLARS = new Set(["price_outlier", "equity_swap"]);
const quarterEnd = (date: string): string => {
  const year = Number(date.slice(0, 4)), quarter = Math.ceil(Number(date.slice(5, 7)) / 3);
  return `${year}-${String(quarter * 3).padStart(2, "0")}-${quarter === 1 || quarter === 4 ? 31 : 30}`;
};

/**
 * The stock lines of a company's original insider reports up to `asOf`, each economic trade once: no amended report
 * (separate evidence, not a second trade), no duplicate copy (the standard's links), no derivative line. `usable` says
 * the line has a dollar value the standard does not flag.
 *
 * The standard links copies within one owner group. Related owners who never sign a report together report the same
 * trade in two (a trust "through LOR, Inc." beside LOR itself, two partners "by" their fund, a husband "by spouse"):
 * an open-market line that another group already reported with the same day, shares and price is that trade again
 * where either of the two holds indirectly. Two people's own equal trades (both direct) stay two.
 */
function* insiderStockLines(filings: InsiderFilingDoc[], asOf: string) {
  const reported = new Map<string, Array<{ groupId: string; indirect: boolean }>>();
  for (const { filing, owners, transactions } of filings) {
    if (filing.form.endsWith("/A") || filing.filingDate > asOf) continue;
    for (const line of transactions) {
      if (line.derivative || line.duplicateOf || !line.transactionDate || !line.code) continue;
      if ((line.code === "P" || line.code === "S") && line.shares !== null && line.price !== null) {
        const key = `${line.transactionDate}|${line.code}|${line.shares}|${line.price}`;
        const indirect = line.directOrIndirect === "I";
        const before = reported.get(key) ?? reported.set(key, []).get(key)!;
        if (before.some((other) => other.groupId !== line.groupId && (indirect || other.indirect))) continue;
        before.push({ groupId: line.groupId, indirect });
      }
      const usable = line.valueUsd !== null && line.valueUsd > 0 && line.price !== null && line.price > 0 && !line.flags.some((flag) => NO_DOLLARS.has(flag));
      yield { filing, owners, line, date: line.transactionDate, code: line.code, usable };
    }
  }
}

/** Who reported a line: the first reporting person of its group, how many reported it jointly, and the role. */
function insiderNamed(owners: InsiderFilingDoc["owners"], groupId: string): { owner: string; more: number; role: string | null } | null {
  const group = owners.filter((owner) => owner.groupId === groupId);
  const named = group[0] ?? owners[0];
  if (!named) return null;
  return { owner: named.ownerName, more: Math.max(0, group.length - 1), role: named.officerTitle?.trim() || (named.director ? "Director" : named.tenPercentOwner ? "10% owner" : named.officer ? "Officer" : null) };
}

/**
 * Insider trading across companies, from the same lines as the company files: the open-market purchases and sales
 * (codes P and S) with a usable dollar value. `days` is the recent period (totals, the largest net buyers and
 * sellers); purchases are listed for twice that, and buying windows for a year. A window starts at a purchase and
 * takes every purchase of the next ten days; it counts when two or more different reporting groups bought in it, and
 * the next window starts after it.
 */
export function buildDeskInsiderMarket(params: { companies: Array<{ cik: number; ticker: string; filings: InsiderFilingDoc[] }>; asOf: string; builtAt: string; days?: number }): DeskInsiderMarket | null {
  const { asOf } = params, days = params.days ?? 90;
  const back = (count: number) => new Date(Date.parse(asOf) - count * DAY).toISOString().slice(0, 10);
  const recent = back(days), listed = back(2 * days), yearAgo = back(365);
  const cents = (value: number) => Math.round(value * 100) / 100;
  const purchases: DeskInsiderMarketTrade[] = [];
  const windows: DeskInsiderWindow[] = [];
  const nets: DeskInsiderCompanyNet[] = [];
  const buyers = new Set<string>(), sellers = new Set<string>();
  let version = "", counted = 0;
  for (const company of params.companies) {
    if (!company.filings.length) continue;
    version ||= company.filings[0].filing.buildVersion;
    counted++;
    const net = { bought: 0, sold: 0, buyers: new Set<string>(), sellers: new Set<string>(), soldUnderPlan: 0 };
    const bought: Array<{ date: string; group: string; value: number; role: string | null }> = [];
    for (const { filing, owners, line, date, code, usable } of insiderStockLines(company.filings, asOf)) {
      if (!usable || (code !== "P" && code !== "S") || date > asOf || date <= yearAgo) continue;
      const who = insiderNamed(owners, line.groupId);
      if (code === "P") {
        bought.push({ date, group: line.groupId, value: line.valueUsd!, role: who?.role ?? null });
        if (date > listed && who) purchases.push({ cik: company.cik, ticker: company.ticker, date, filed: filing.filingDate, accession: filing.accessionNo, owner: who.owner, more: who.more, role: who.role, shares: line.shares, price: line.price, valueUsd: cents(line.valueUsd!) });
      }
      if (date <= recent) continue;
      const key = `${company.cik}:${line.groupId}`;
      if (code === "P") { net.bought += line.valueUsd!; net.buyers.add(line.groupId); buyers.add(key); }
      else { net.sold += line.valueUsd!; net.sellers.add(line.groupId); sellers.add(key); if (line.plan10b5) net.soldUnderPlan += line.valueUsd!; }
    }
    if (net.bought > 0 || net.sold > 0) nets.push({ cik: company.cik, ticker: company.ticker, bought: cents(net.bought), sold: cents(net.sold), buyers: net.buyers.size, sellers: net.sellers.size, soldUnderPlan: cents(net.soldUnderPlan) });
    bought.sort((a, b) => a.date.localeCompare(b.date));
    for (let at = 0; at < bought.length;) {
      const until = new Date(Date.parse(bought[at].date) + 10 * DAY).toISOString().slice(0, 10);
      let end = at;
      while (end + 1 < bought.length && bought[end + 1].date <= until) end++;
      const inside = bought.slice(at, end + 1), groups = new Set(inside.map((item) => item.group));
      if (groups.size >= 2) {
        windows.push({
          cik: company.cik, ticker: company.ticker, start: inside[0].date, end: inside[inside.length - 1].date, insiders: groups.size,
          valueUsd: cents(inside.reduce((sum, item) => sum + item.value, 0)), roles: [...new Set(inside.map((item) => item.role).filter((role): role is string => role !== null))].slice(0, 4),
        });
      }
      at = end + 1;
    }
  }
  if (!version) return null;
  purchases.sort((a, b) => b.date.localeCompare(a.date) || b.valueUsd - a.valueUsd || a.ticker.localeCompare(b.ticker));
  windows.sort((a, b) => b.end.localeCompare(a.end) || b.valueUsd - a.valueUsd || a.ticker.localeCompare(b.ticker));
  const byNet = [...nets].sort((a, b) => (b.bought - b.sold) - (a.bought - a.sold) || a.ticker.localeCompare(b.ticker));
  return {
    schemaVersion: DESK_COMPANY_SCHEMA_VERSION, version, asOf, builtAt: params.builtAt, companies: counted, days,
    totals: {
      bought: cents(nets.reduce((sum, row) => sum + row.bought, 0)), sold: cents(nets.reduce((sum, row) => sum + row.sold, 0)), buyers: buyers.size, sellers: sellers.size,
      buyingCompanies: nets.filter((row) => row.bought > 0).length, sellingCompanies: nets.filter((row) => row.sold > 0).length, soldUnderPlan: cents(nets.reduce((sum, row) => sum + row.soldUnderPlan, 0)),
    },
    purchases: purchases.slice(0, 60), windows: windows.slice(0, 40),
    netBuyers: byNet.filter((row) => row.bought > row.sold).slice(0, 10), netSellers: byNet.filter((row) => row.sold > row.bought).reverse().slice(0, 10),
  };
}

/**
 * A company's insider transactions for the page: the stock lines of original reports (an amended report is separate
 * evidence, not a second trade), each economic trade once (the standard's duplicate links), no derivative lines.
 * Dollar sums count open-market purchases and sales only (codes P and S) and leave out lines the standard flags.
 * `asOf` is the last filing date the standard holds for any company: the windows end there.
 */
export function buildDeskCompanyInsiders(params: { cik: number; ticker: string; filings: InsiderFilingDoc[]; asOf: string; builtAt: string; years?: number; marketLimit?: number; otherLimit?: number }): DeskCompanyInsiders | null {
  const { asOf } = params;
  const back = (days: number) => new Date(Date.parse(asOf) - days * DAY).toISOString().slice(0, 10);
  const since = back((params.years ?? 3) * 365.25), yearAgo = back(365);
  const ends: string[] = [];
  // twenty calendar quarters ending with the one `asOf` is in: step back three months at a time
  for (let end = quarterEnd(asOf); ends.length < 20; end = quarterEnd(new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 4, 15)).toISOString().slice(0, 10))) ends.unshift(end);
  const quarters = new Map(ends.map((end) => [end, { bought: 0, sold: 0, buyers: new Set<string>(), sellers: new Set<string>() }]));
  const year = { bought: 0, sold: 0, buyers: new Set<string>(), sellers: new Set<string>(), soldUnderPlan: 0 };
  const trades: DeskCompanyInsiders["trades"] = [];
  const version = params.filings[0]?.filing.buildVersion ?? "";
  for (const { filing, owners, line, date, code, usable } of insiderStockLines(params.filings, asOf)) {
    if (usable && (code === "P" || code === "S")) {
      const quarter = quarters.get(quarterEnd(date));
      const side = code === "P" ? "bought" : "sold";
      if (quarter) { quarter[side] += line.valueUsd!; quarter[code === "P" ? "buyers" : "sellers"].add(line.groupId); }
      if (date > yearAgo && date <= asOf) {
        year[side] += line.valueUsd!;
        year[code === "P" ? "buyers" : "sellers"].add(line.groupId);
        if (code === "S" && line.plan10b5) year.soldUnderPlan += line.valueUsd!;
      }
    }
    if (filing.filingDate < since) continue;
    const who = insiderNamed(owners, line.groupId);
    if (!who) continue;
    trades.push({ date, filed: filing.filingDate, owner: who.owner, more: who.more, role: who.role, code, shares: line.shares, price: line.price, valueUsd: usable ? line.valueUsd : null, plan: line.plan10b5 });
  }
  if (!version) return null;
  const newestFirst = (a: DeskCompanyInsiders["trades"][number], b: DeskCompanyInsiders["trades"][number]) => b.date.localeCompare(a.date) || b.filed.localeCompare(a.filed) || (b.valueUsd ?? 0) - (a.valueUsd ?? 0);
  trades.sort(newestFirst);
  // Grants and tax lines outnumber the trades that say something: the open-market ones are kept first, so a
  // purchase of two years ago is not pushed out of the file by this year's vesting lines.
  const market = trades.filter((trade) => trade.code === "P" || trade.code === "S");
  const other = trades.filter((trade) => trade.code !== "P" && trade.code !== "S");
  const kept = [...market.slice(0, params.marketLimit ?? 300), ...other.slice(0, params.otherLimit ?? 150)].sort(newestFirst);
  const cents = (value: number) => Math.round(value * 100) / 100;
  return {
    schemaVersion: DESK_COMPANY_SCHEMA_VERSION, cik: params.cik, ticker: params.ticker, version, asOf, builtAt: params.builtAt,
    trades: kept, tradeCount: trades.length, marketCount: market.length,
    quarters: ends.map((end) => { const q = quarters.get(end)!; return { quarter: end, bought: cents(q.bought), sold: cents(q.sold), buyers: q.buyers.size, sellers: q.sellers.size }; }),
    year: { bought: cents(year.bought), sold: cents(year.sold), buyers: year.buyers.size, sellers: year.sellers.size, soldUnderPlan: cents(year.soldUnderPlan) },
  };
}

// --- filings: the release calendar --------------------------------------------------------------------------------------------

/** One row of the release calendar's filings files (only the fields used here). */
export interface CalendarFilingRow {
  cik: number;
  accessionNo: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  acceptedEt: string | null;
  items: string | null;
  isEarningsRelease: boolean;
  primaryDoc: string | null;
  cachedFiles: Array<{ name: string; bytes: number }>;
}

/** A cached exhibit's name: the accession without dashes, ".ex", an optional name, ".htm". Nothing else is ever opened. */
export const EXHIBIT_FILE = /^\d{18}\.ex[A-Za-z0-9._-]{0,80}\.html?$/;

/**
 * A company's reports of the last years, newest first. An earnings release lists its cached exhibits (largest first:
 * the release itself is usually the largest) so the page can show their text; other filings link to the SEC.
 */
export function buildDeskCompanyFilings(params: { cik: number; ticker: string; rows: CalendarFilingRow[]; asOf: string; builtAt: string; years?: number }): DeskCompanyFilings | null {
  const since = new Date(Date.parse(params.asOf) - (params.years ?? 5) * 365.25 * DAY).toISOString().slice(0, 10);
  const seen = new Set<string>();
  const filings: DeskCompanyFilings["filings"] = [];
  for (const row of params.rows) {
    if (row.filingDate < since || row.filingDate > params.asOf || seen.has(row.accessionNo)) continue;
    seen.add(row.accessionNo);
    const stem = row.accessionNo.replaceAll("-", "");
    filings.push({
      accession: row.accessionNo, form: row.form, filed: row.filingDate, acceptedEt: row.acceptedEt, period: row.reportDate,
      items: (row.items ?? "").split(",").map((item) => item.trim()).filter(Boolean), earnings: row.isEarningsRelease, primaryDoc: row.primaryDoc,
      exhibits: row.isEarningsRelease
        ? [...row.cachedFiles].filter((file) => file.name.startsWith(`${stem}.ex`) && EXHIBIT_FILE.test(file.name)).sort((a, b) => b.bytes - a.bytes).map((file) => file.name)
        : [],
    });
  }
  if (!filings.length) return null;
  filings.sort((a, b) => b.filed.localeCompare(a.filed) || (b.acceptedEt ?? "").localeCompare(a.acceptedEt ?? "") || b.accession.localeCompare(a.accession));
  return { schemaVersion: DESK_COMPANY_SCHEMA_VERSION, cik: params.cik, ticker: params.ticker, asOf: params.asOf, builtAt: params.builtAt, filings };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", middot: "·", reg: "®", trade: "™", copy: "©", hellip: "…", cent: "¢", sect: "§", deg: "°" };

/**
 * An HTML exhibit as paragraphs of plain text: scripts, styles and hidden XBRL headers dropped, a paragraph per block,
 * a table row per paragraph with its cells set apart by " | ". No markup survives, so the page shows text only.
 */
export function htmlToParagraphs(html: string, limit = 1500): { paragraphs: string[]; truncated: boolean } {
  // an exhibit saved out of the SEC's full submission starts with that file's own header lines (type, sequence, file name) before <TEXT>
  const body = html.search(/<TEXT>/i);
  const text = (body >= 0 ? html.slice(body + 6) : html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|ix:header)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(td|th)\s*>/gi, "\u0001")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
  const paragraphs: string[] = [];
  for (const raw of text.split("\n")) {
    const cells = raw.split("\u0001").map((cell) => cell.replace(/[\s ]+/g, " ").trim()).filter(Boolean);
    // "$" and ")" get their own cells in release tables: join them back to their numbers
    const line = cells.join(" | ").replace(/\$ \| /g, "$").replace(/\( \| /g, "(").replace(/ \| \)/g, ")").replace(/ \| %/g, "%");
    if (line) paragraphs.push(line);
    if (paragraphs.length >= limit) return { paragraphs, truncated: true };
  }
  return { paragraphs, truncated: false };
}
