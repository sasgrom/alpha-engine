/**
 * Adjusted (non-GAAP) earnings per share as an earnings release prints them, read from the tables of its exhibits.
 *
 * Companies that guide on an adjusted basis report the adjusted figure in a reconciliation table: GAAP earnings per
 * share, the adjustments, then a row such as "Adjusted diluted EPS" or "Non-GAAP net income per diluted share". The
 * filed statements (XBRL) carry GAAP only, so this row is the only place the reported adjusted figure exists.
 *
 * A row counts when its own label, or the heading it stands under, says adjusted / non-GAAP / core / operating and
 * names a per-share figure, and it is not the GAAP line, a growth rate, an adjustment or guidance.
 *
 * Which printed figure belongs to which period is settled by the GAAP line of the same table: the GAAP earnings per
 * share of the quarter (and of the quarter a year before) are known from the filed statements, so the column where the
 * table's GAAP row prints that figure is that period's column, whatever the headers look like. The same holds for
 * tables turned the other way (measures as columns, "Reported (GAAP)" and "Comparable (Non-GAAP)" as rows) and for a
 * per-share row that carries "as reported", the adjustments and "as adjusted" side by side. Only where
 * a table has no GAAP line are the period columns taken from its headers, with the release-figure parser
 * (flash-html.ts). The figure of a period is taken only when the readings agree: rows labelled diluted come first, then the others; different figures at the same rank are
 * ambiguous and nothing is taken. Pure: no file or network access here.
 */
import { canonicalLabel, daysBetween, detectPeriodColumns, extractCandidateRows, parseExhibitHtml, parsePrintedNumber, type RawTable, type StatementColumn } from "./flash-html";

export const ADJUSTED_EPS_VERSION = "a2";

const ADJUSTED = /\b(adjusted|non[- ]?gaap|core|operating|normalized|comparable|underlying|economic|ongoing|excluding)\b/i;
const PER_SHARE = /\b(?:e\.?p\.?s\.?|(?:earnings|income|loss|profit)(?:\s*\(loss\))?[^|]{0,70}per[^|]{0,16}share|per (?:diluted |common |basic )*share)\b/i;
/** Rows of a reconciliation that are not the adjusted figure itself. */
const NOT_THE_FIGURE = /\b(growth|change|increase|decrease|guidance|outlook|forecast|expected|range|impact|effect|adjustments?|dividends?|book value|cash flow|ffo|affo|revenue|sales|tax rate|weighted|shares used|share count|percent|margin)\b|%/i;
const GAAP_LINE = /(?<!non[- ]?)\bgaap\b|\bas reported\b|\breported\b/i;
/** A period column is the release's own quarter when it ends within this many days of the expected period end. */
const PERIOD_DAYS = 10;
/** No company earns this much a share in a quarter; a larger number is a total, not a per-share figure. */
const MAX_PER_SHARE = 500;

export interface AdjustedEpsExhibit { file: string; sha256: string; html: string }

export interface AdjustedEpsReading {
  file: string;
  tableIndex: number;
  rowIndex: number;
  label: string;
  heading: string | null;
  /** The label or its heading says diluted. */
  diluted: boolean;
  basic: boolean;
  /** 3 for the quarter, 12 for the fiscal year, 6 or 9 for the year to date. */
  months: number;
  periodEnd: string;
  value: number;
  raw: string;
  /** How the period was settled: by the GAAP row's column, by the GAAP row's block (measures as columns), or by the table's period headers. */
  how: "gaap_column" | "gaap_block" | "gaap_row" | "period_header";
}

export interface AdjustedEpsFigure {
  value: number;
  /** "diluted" when rows labelled diluted gave it, "basic" for basic rows, else "unlabelled". */
  basis: "diluted" | "unlabelled" | "basic";
  /** How many rows printed this figure, and in how many tables. */
  readings: number;
  tables: number;
  label: string;
  file: string;
  tableIndex: number;
  rowIndex: number;
}

export interface AdjustedEpsResult {
  /** Every adjusted per-share row found, for any period. */
  readings: AdjustedEpsReading[];
  quarter: AdjustedEpsFigure | null;
  /** The fiscal year ending at the expected period end (a fourth-quarter release prints it beside the quarter). */
  year: AdjustedEpsFigure | null;
  /** Why a period has no figure although rows were found: "ambiguous" (rows of the same rank disagree). */
  quarterNote: "ambiguous" | null;
  yearNote: "ambiguous" | null;
}

/** True when a row label (with the headings above it) names an adjusted per-share figure itself. */
export function isAdjustedEpsLabel(label: string, headings: string[] = []): boolean {
  const text = canonicalLabel(label);
  if (!PER_SHARE.test(text) || NOT_THE_FIGURE.test(text) || GAAP_LINE.test(text)) return false;
  if (ADJUSTED.test(text)) return true;
  // an unmarked "diluted earnings per share" under a heading "Non-GAAP" or "Adjusted"; a heading "GAAP" takes it away
  const heading = headings.at(-1);
  return heading !== undefined && ADJUSTED.test(heading) && !GAAP_LINE.test(canonicalLabel(heading)) && !NOT_THE_FIGURE.test(canonicalLabel(heading));
}

/** A period the release reports, with the GAAP earnings per diluted share known for it (several candidates: as filed, and after later splits). */
export interface EpsAnchor { months: number; periodEnd: string; gaap: number[] }

interface PlainRow { rowIndex: number; label: string; heading: string | null; values: Array<number | null>; texts: number }

/** Every row of a table as its label and its printed numbers in order (a dash keeps its place as null); no period logic. */
function plainRows(table: RawTable): PlainRow[] {
  const out: PlainRow[] = [];
  let heading: string | null = null;
  table.grid.forEach((row, rowIndex) => {
    const cells = row.filter((cell, col) => col === 0 || row[col] !== row[col - 1]).map((cell) => cell.text).filter((text) => text !== "");
    if (!cells.length) return;
    let label = "";
    const values: Array<number | null> = [];
    let pendingNegative = false, texts = 0;
    for (const text of cells) {
      if (/^[$]+$/.test(text)) continue;
      if (text === "(" || text === "$(" || text === "$ (") { pendingNegative = true; continue; }
      if (text === ")" || text === "%" || text === ")%") { if (text.includes(")") && values.length && values[values.length - 1] !== null) values[values.length - 1] = -Math.abs(values[values.length - 1]!); continue; }
      const parsed = parsePrintedNumber(text);
      if (!parsed) { texts++; if (!label && !values.length) label = text; continue; }
      values.push(parsed.value === null ? null : pendingNegative ? -Math.abs(parsed.value) : parsed.value);
      pendingNegative = false;
    }
    if (!label) return;
    if (!values.some((value) => value !== null)) { if (texts === 1) heading = label; out.push({ rowIndex, label, heading: null, values: [], texts }); return; }
    out.push({ rowIndex, label, heading, values, texts });
  });
  return out;
}

const isGaapEpsLabel = (label: string) => { const text = canonicalLabel(label); return PER_SHARE.test(text) && !NOT_THE_FIGURE.test(text) && (GAAP_LINE.test(text) || !ADJUSTED.test(text)); };
const matches = (value: number | null, candidates: number[]) => value !== null && candidates.some((candidate) => Math.abs(value - candidate) <= ANCHOR_CENTS);
/** A printed GAAP figure may differ by a cent from the filed one (a fourth quarter derived from the year). */
const ANCHOR_CENTS = 0.0101;

/**
 * Reconciliation in rows: a GAAP per-share row and an adjusted per-share row with the same number of printed figures.
 * The column of a period is the one where the GAAP row prints the GAAP figure known for that period.
 */
function anchoredRows(table: RawTable, rows: PlainRow[], anchors: EpsAnchor[]): AdjustedEpsReading[] {
  const gaapRows = rows.filter((row) => row.values.length && isGaapEpsLabel(row.label) && !isAdjustedEpsLabel(row.label, row.heading ? [row.heading] : []));
  const adjustedRows = rows.filter((row) => row.values.length && isAdjustedEpsLabel(row.label, row.heading ? [row.heading] : []));
  const out: AdjustedEpsReading[] = [];
  for (const adjusted of adjustedRows) {
    const words = `${adjusted.label} ${adjusted.heading ?? ""}`;
    for (const anchor of anchors) {
      // the columns where some GAAP row of the same width prints this period's GAAP figure
      const columns = new Set<number>();
      for (const gaap of gaapRows) {
        if (gaap.values.length !== adjusted.values.length) continue;
        gaap.values.forEach((value, column) => { if (matches(value, anchor.gaap)) columns.add(column); });
      }
      const figures = new Set([...columns].map((column) => adjusted.values[column]).filter((value): value is number => value !== null && Math.abs(value) <= MAX_PER_SHARE).map((value) => Math.round(value * 100)));
      if (figures.size !== 1) continue;
      const value = [...figures][0] / 100;
      out.push({
        file: table.sourceFile, tableIndex: table.tableIndex, rowIndex: adjusted.rowIndex, label: adjusted.label, heading: adjusted.heading, diluted: /dilut/i.test(words), basic: /\bbasic\b/i.test(words) && !/dilut/i.test(words),
        months: anchor.months, periodEnd: anchor.periodEnd, value, raw: String(value), how: "gaap_column",
      });
    }
  }
  return out;
}

/**
 * Reconciliation in columns: the measures are the columns (one of them a per-share figure, the last), and the rows
 * are "Reported (GAAP)", the adjustments and "Comparable (Non-GAAP)", one such block per period. The block of a period
 * is the one whose GAAP row prints the GAAP figure known for it in the per-share column.
 */
function anchoredColumns(table: RawTable, rows: PlainRow[], anchors: EpsAnchor[]): AdjustedEpsReading[] {
  const out: AdjustedEpsReading[] = [];
  let perShareLast = false, gaapRow: PlainRow | null = null, header = "";
  for (const row of rows) {
    if (!row.values.length) {
      // a row of measure names: several texts, the last one a per-share measure
      if (row.texts >= 3) {
        const cells = table.grid[row.rowIndex].filter((cell, col) => col === 0 || table.grid[row.rowIndex][col] !== table.grid[row.rowIndex][col - 1]).map((cell) => cell.text).filter((text) => text !== "");
        perShareLast = PER_SHARE.test(canonicalLabel(cells[cells.length - 1])) && !NOT_THE_FIGURE.test(canonicalLabel(cells[cells.length - 1]));
        header = cells[cells.length - 1];
        gaapRow = null;
      }
      continue;
    }
    if (!perShareLast) continue;
    const text = canonicalLabel(row.label), last = row.values[row.values.length - 1];
    if (PER_SHARE.test(text)) continue;                      // a row layout, not this one
    if (GAAP_LINE.test(text)) { gaapRow = row; continue; }
    if (!gaapRow || !ADJUSTED.test(text) || NOT_THE_FIGURE.test(text) || last === null || Math.abs(last) > MAX_PER_SHARE) continue;
    for (const anchor of anchors) {
      if (!matches(gaapRow.values[gaapRow.values.length - 1], anchor.gaap)) continue;
      out.push({
        file: table.sourceFile, tableIndex: table.tableIndex, rowIndex: row.rowIndex, label: `${row.label} · ${header}`, heading: null, diluted: /dilut/i.test(header), basic: /\bbasic\b/i.test(header) && !/dilut/i.test(header),
        months: anchor.months, periodEnd: anchor.periodEnd, value: last, raw: String(last), how: "gaap_block",
      });
    }
    gaapRow = null;
  }
  return out;
}

/**
 * Reconciliation across one row: the per-share row itself carries "as reported", the adjustments and "as adjusted"
 * side by side, under column headers that say so (Abbott, Clorox). The row belongs to the period whose GAAP figure its
 * first number is; its last number is the adjusted figure when the last column header says adjusted, and, where the
 * adjustments are printed between them, when GAAP plus the adjustments gives it to the cent.
 */
function anchoredAcross(table: RawTable, rows: PlainRow[], anchors: EpsAnchor[]): AdjustedEpsReading[] {
  const out: AdjustedEpsReading[] = [];
  let lastHeader: string | null = null, gaapHeader = false;
  for (const row of rows) {
    if (!row.values.length) {
      if (row.texts >= 2) {
        const cells = table.grid[row.rowIndex].filter((cell, col) => col === 0 || table.grid[row.rowIndex][col] !== table.grid[row.rowIndex][col - 1]).map((cell) => cell.text).filter((text) => text !== "");
        const last = canonicalLabel(cells[cells.length - 1]);
        lastHeader = ADJUSTED.test(last) && !GAAP_LINE.test(last) && !NOT_THE_FIGURE.test(last) && !PER_SHARE.test(last) ? cells[cells.length - 1] : null;
        gaapHeader = cells.slice(0, -1).some((cell) => GAAP_LINE.test(canonicalLabel(cell)));
      }
      continue;
    }
    if (!lastHeader || !gaapHeader || row.values.length < 2 || row.values.length > 6 || !isGaapEpsLabel(row.label) || isAdjustedEpsLabel(row.label)) continue;
    const first = row.values[0], last = row.values[row.values.length - 1];
    if (first === null || last === null || Math.abs(last) > MAX_PER_SHARE) continue;
    const between = row.values.slice(1, -1);
    if (between.length && Math.abs(first + between.reduce<number>((sum, value) => sum + (value ?? 0), 0) - last) > 0.0151) continue;
    for (const anchor of anchors) {
      if (!matches(first, anchor.gaap)) continue;
      out.push({
        file: table.sourceFile, tableIndex: table.tableIndex, rowIndex: row.rowIndex, label: `${row.label} · ${lastHeader}`, heading: null, diluted: /dilut/i.test(row.label), basic: /\bbasic\b/i.test(row.label) && !/dilut/i.test(row.label),
        months: anchor.months, periodEnd: anchor.periodEnd, value: last, raw: String(last), how: "gaap_row",
      });
    }
  }
  return out;
}

/** The period columns as the statement reader finds them (the first version's way): used where a table has no GAAP line to anchor on. */
function headerRows(table: RawTable, expectedPeriodEnd: string): AdjustedEpsReading[] {
  let columns: StatementColumn[];
  let rows: ReturnType<typeof extractCandidateRows>;
  try {
    columns = detectPeriodColumns(table, "income", expectedPeriodEnd);
    if (!columns.length) return [];
    rows = extractCandidateRows({ kind: "income", score: 0, tables: [table], columns });
  } catch {
    return [];
  }
  const out: AdjustedEpsReading[] = [];
  for (const row of rows) {
    if (row.kind !== "data" || !row.alignable || !isAdjustedEpsLabel(row.label, row.headingPath)) continue;
    const words = `${row.label} ${row.headingPath.at(-1) ?? ""}`;
    columns.forEach((column, index) => {
      const printed = row.values[index];
      if (!printed || printed.value === null || printed.percent || Math.abs(printed.value) > MAX_PER_SHARE) return;
      out.push({
        file: table.sourceFile, tableIndex: table.tableIndex, rowIndex: row.rowIndex, label: row.label, heading: row.headingPath.at(-1) ?? null,
        diluted: /dilut/i.test(words), basic: /\bbasic\b/i.test(words) && !/dilut/i.test(words), months: column.months, periodEnd: column.periodEnd, value: printed.value, raw: printed.raw, how: "period_header",
      });
    });
  }
  return out;
}

function rowsOf(table: RawTable, expectedPeriodEnd: string, anchors: EpsAnchor[]): AdjustedEpsReading[] {
  // cheap test first: most tables of a release name no per-share figure at all
  if (!table.grid.some((row) => row.some((cell) => cell.text.length < 200 && PER_SHARE.test(cell.text)))) return [];
  const rows = plainRows(table);
  const anchored = [...anchoredRows(table, rows, anchors), ...anchoredColumns(table, rows, anchors), ...anchoredAcross(table, rows, anchors)];
  // A period the GAAP line has settled is not read again from the column headers; the headers serve the other periods.
  const settled = new Set(anchored.map((reading) => `${reading.rowIndex}|${reading.months}|${reading.periodEnd}`));
  return [...anchored, ...headerRows(table, expectedPeriodEnd).filter((reading) => !settled.has(`${reading.rowIndex}|${reading.months}|${reading.periodEnd}`))];
}

/** The figure the readings of one period agree on: diluted rows decide, then unlabelled, then basic; a rank that disagrees decides nothing. */
export function agreeOn(readings: AdjustedEpsReading[]): { figure: AdjustedEpsFigure | null; note: "ambiguous" | null } {
  const ranks: Array<[AdjustedEpsFigure["basis"], AdjustedEpsReading[]]> = [
    ["diluted", readings.filter((reading) => reading.diluted)],
    ["unlabelled", readings.filter((reading) => !reading.diluted && !reading.basic)],
    ["basic", readings.filter((reading) => reading.basic)],
  ];
  for (const [basis, list] of ranks) {
    if (!list.length) continue;
    const cents = new Map<number, AdjustedEpsReading[]>();
    for (const reading of list) cents.set(Math.round(reading.value * 100), [...(cents.get(Math.round(reading.value * 100)) ?? []), reading]);
    if (cents.size > 1) return { figure: null, note: "ambiguous" };
    const same = [...cents.values()][0], first = same[0];
    return {
      figure: { value: first.value, basis, readings: same.length, tables: new Set(same.map((reading) => `${reading.file}|${reading.tableIndex}`)).size, label: first.label, file: first.file, tableIndex: first.tableIndex, rowIndex: first.rowIndex },
      note: null,
    };
  }
  return { figure: null, note: null };
}

// --- deciding per company ------------------------------------------------------------------------------------------------

/** One adjusted per-share row of a release for one period, kept small for the per-company files. */
export interface StoredReading { months: number; periodEnd: string; value: number; diluted: boolean; basic: boolean; label: string; file: string; tableIndex: number; rowIndex: number; how?: AdjustedEpsReading["how"] }
export interface StoredRelease { accession: string; acceptedEt: string; fiscalPeriodEnd: string; readings: StoredReading[] }

/**
 * How far a figure is borne out:
 *   confirmed   a later release prints the same figure for the period (to the cent, or after the splits in between)
 *   same_row    not printed again yet, but read from the row whose figures later releases have confirmed before
 *   restated    a later release prints another figure for the period (a recast measure, or a misread)
 *   unchecked   nothing to check it with
 * Only confirmed and same_row figures are for use.
 */
export type AdjustedEpsGrade = "confirmed" | "same_row" | "restated" | "unchecked";
export interface DecidedFigure { value: number; grade: AdjustedEpsGrade; label: string; diluted: boolean; file: string; tableIndex: number; rowIndex: number; how: AdjustedEpsReading["how"]; laterValues: number[] }
export interface DecidedRelease { accession: string; acceptedEt: string; fiscalPeriodEnd: string; quarter: DecidedFigure | null; year: DecidedFigure | null; quarterNote: string | null; yearNote: string | null }

/** A row label without its footnote marks, so that the same row is the same row from release to release. */
export function rowKey(label: string): string {
  return canonicalLabel(label).replace(/[¹²³⁰-⁹*†‡]+/g, " ").replace(/\s*\(\s*(?:\d{1,2}|[a-z])\s*\)/g, " ").replace(/\s+\d{1,2}$/g, "").replace(/[\s:;,.\-–—]+$/g, "").replace(/\s+/g, " ").trim();
}

/** Per-share lines that are not earnings of the whole company, whatever else their label says. */
const OTHER_PER_SHARE = /\b(distributions?|discontinued|dividends?)\b/i;
const DAY = 86_400_000;
const nearPeriod = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= PERIOD_DAYS * DAY;
const cents = (value: number) => Math.round(value * 100);

/**
 * The figures of one company, release by release. A row label is trusted when later releases have repeated its
 * figures at least twice and in at least 80% of the cases where they printed the period again; the release's figure
 * is read from the most often confirmed trusted row it has. Without a trusted row the release's readings must agree
 * among themselves (agreeOn), and the figure is used only if a later release confirms it.
 * `splits` are the company's splits (date, ratio): a later release restates an earlier quarter for them.
 */
export function decideCompany(releases: StoredRelease[], splits: Array<{ date: string; ratio: number }> = []): DecidedRelease[] {
  // Only rows whose own label says adjusted are decided on. A plain "earnings per share" row standing under an
  // adjusted heading is as often the GAAP line or a dividend line (found on the full read: Analog Devices 2017, UDR's
  // distributions), and a later release repeating it proves nothing about its meaning.
  const ordered = [...releases].sort((a, b) => a.acceptedEt.localeCompare(b.acceptedEt))
    .map((release) => ({ ...release, readings: release.readings.filter((reading) => isAdjustedEpsLabel(reading.label) && !OTHER_PER_SHARE.test(reading.label)) }));
  const splitFactor = (from: string, to: string) => splits.filter((split) => split.date > from.slice(0, 10) && split.date <= to.slice(0, 10) && split.ratio > 0).reduce((product, split) => product * split.ratio, 1);
  // what later releases print for a period: [value put back on the earlier release's share basis]
  const laterValues = (release: StoredRelease, months: number): number[] => {
    const values: number[] = [];
    for (const other of ordered) {
      if (other.acceptedEt <= release.acceptedEt || other.accession === release.accession) continue;
      const factor = splitFactor(release.acceptedEt, other.acceptedEt);
      for (const reading of other.readings) if (reading.months === months && nearPeriod(reading.periodEnd, release.fiscalPeriodEnd)) values.push(reading.value * factor);
    }
    return values;
  };
  const own = (release: StoredRelease, months: number) => release.readings.filter((reading) => reading.months === months && nearPeriod(reading.periodEnd, release.fiscalPeriodEnd));
  const equal = (value: number, later: number[]) => later.some((other) => Math.abs(cents(other) - cents(value)) <= 1);
  // the record of every row label over the company's releases (quarters only: they are the many)
  const record = new Map<string, { confirmed: number; checked: number }>();
  for (const release of ordered) {
    const later = laterValues(release, 3);
    if (!later.length) continue;
    const seen = new Set<string>();
    for (const reading of own(release, 3)) {
      const key = rowKey(reading.label);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = record.get(key) ?? record.set(key, { confirmed: 0, checked: 0 }).get(key)!;
      entry.checked++;
      if (equal(reading.value, later)) entry.confirmed++;
    }
  }
  const trusted = (label: string) => { const entry = record.get(rowKey(label)); return entry !== undefined && entry.confirmed >= 2 && entry.confirmed >= 0.8 * entry.checked; };
  const decide = (release: StoredRelease, months: number): { figure: DecidedFigure | null; note: string | null } => {
    const readings = own(release, months);
    if (!readings.length) return { figure: null, note: null };
    const later = laterValues(release, months);
    const grade = (value: number, row: boolean): AdjustedEpsGrade => (later.length ? (equal(value, later) ? "confirmed" : "restated") : row ? "same_row" : "unchecked");
    const figure = (reading: StoredReading, row: boolean): DecidedFigure => ({
      value: reading.value, grade: grade(reading.value, row), label: reading.label, diluted: reading.diluted, file: reading.file, tableIndex: reading.tableIndex, rowIndex: reading.rowIndex, how: reading.how ?? "period_header",
      laterValues: [...new Set(later.map((value) => Math.round(value * 1e4) / 1e4))].slice(0, 6),
    });
    const rows = readings.filter((reading) => trusted(reading.label)).sort((a, b) => (record.get(rowKey(b.label))!.confirmed - record.get(rowKey(a.label))!.confirmed) || Number(b.diluted) - Number(a.diluted));
    if (rows.length) {
      const best = rows.filter((reading) => rowKey(reading.label) === rowKey(rows[0].label));
      if (new Set(best.map((reading) => cents(reading.value))).size > 1) return { figure: null, note: "ambiguous" };
      return { figure: figure(best[0], true), note: null };
    }
    const agreed = agreeOn(readings.map((reading) => ({ ...reading, heading: null, raw: "", how: reading.how ?? "period_header" })));
    if (!agreed.figure) return { figure: null, note: agreed.note };
    const reading = readings.find((item) => item.file === agreed.figure!.file && item.tableIndex === agreed.figure!.tableIndex && item.rowIndex === agreed.figure!.rowIndex)!;
    return { figure: figure(reading, false), note: null };
  };
  return ordered.map((release) => {
    const quarter = decide(release, 3), year = decide(release, 12);
    return { accession: release.accession, acceptedEt: release.acceptedEt, fiscalPeriodEnd: release.fiscalPeriodEnd, quarter: quarter.figure, year: year.figure, quarterNote: quarter.note, yearNote: year.note };
  });
}

export function adjustedEpsFromExhibits(exhibits: AdjustedEpsExhibit[], expectedPeriodEnd: string, anchors: EpsAnchor[] = []): AdjustedEpsResult {
  const readings: AdjustedEpsReading[] = [];
  const seen = new Set<string>();
  for (const exhibit of exhibits) {
    if (seen.has(exhibit.sha256)) continue;
    seen.add(exhibit.sha256);
    let tables: RawTable[];
    try { tables = parseExhibitHtml(exhibit.html, exhibit.file, exhibit.sha256); } catch { continue; }
    for (const table of tables) readings.push(...rowsOf(table, expectedPeriodEnd, anchors));
  }
  const at = (months: number) => readings.filter((reading) => reading.months === months && daysBetween(reading.periodEnd, expectedPeriodEnd) <= PERIOD_DAYS && daysBetween(expectedPeriodEnd, reading.periodEnd) <= PERIOD_DAYS);
  const quarter = agreeOn(at(3)), year = agreeOn(at(12));
  return { readings, quarter: quarter.figure, year: year.figure, quarterNote: quarter.note, yearNote: year.note };
}
