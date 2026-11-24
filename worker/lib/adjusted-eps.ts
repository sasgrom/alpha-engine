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
 * per-share row that carries "as reported", the adjustments and "as adjusted" side by side, for a row that prints
 * GAAP figures in one half and adjusted ones in the other or the two in turn, for rows named "GAAP" and "Non-GAAP"
 * under a per-share heading, and for twin tables headed "GAAP" and "Non-GAAP". Only where
 * a table has no GAAP line are the period columns taken from its headers, with the release-figure parser
 * (flash-html.ts). The figure of a period is taken only when the readings agree: rows labelled diluted come first, then the others; different figures at the same rank are
 * ambiguous and nothing is taken. Pure: no file or network access here.
 *
 * Guards learned on the full read (a4): a caption of units ("In millions, except per share amounts") is not a
 * per-share heading, and a row named by its basis that names another measure ("Operating Ratio", "Adjusted EBITDA")
 * or a part of the reconciliation ("Less: ...", "Items excluded from ...") is not the figure; a GAAP row is paired
 * only with rows of its own period block (no "Six months ended" between them); a printed GAAP figure belongs to the
 * nearest known figure only, so a year-ago quarter a cent away does not pass for this one; a row whose figures add up
 * as reported, adjustments and adjusted is read side by side, never as GAAP and adjusted halves; basic rows are not
 * anchored on the diluted figures; and an adjusted figure 40 times the GAAP one (above 10) is an amount.
 *
 * And on the a4 read (a5): a figure filed to the cent must be printed to the cent (only a computed one, such as a
 * fourth quarter from the year, or a row of continuing operations may be a cent away), and a printed figure belongs to
 * a period's first report before a later version that repeats it; a figure two periods share goes to the one not
 * printed elsewhere in the row, and two such figures are told apart by order (the newer first, unless the year header
 * runs the other way); an adjusted figure that is another period's GAAP figure is not taken; a row naming periods
 * side by side ("2nd Quarter | Year to Date") heads the columns again
 * and starts no block; rows that start with different years are not paired; "non-operating" and "non-core" items are
 * not operating or core figures, and constant-currency or pre-tax figures are not the figure; the adjusted figure of
 * a block is its last adjusted row (the adjustments between may say "excluding" too); a side-by-side reconciliation
 * is no twin table, and its subtotal of the adjustments counts once; readings the GAAP line placed outrank readings
 * the headers placed.
 *
 * And on the a5 read (a6): a release often prints its GAAP figure a cent from the filed one (continuing operations
 * against all operations, another rounding), so a figure a cent away places its period after all, but only where the
 * row prints no figure of that period to the cent and the row is a quarter's: it places another period too, or the
 * table's own words (the label, the nearest header that names a period, or the title) name a quarter and no longer
 * period; a fourth quarter computed from the year is known as computed from the filed figures, not by its decimals.
 * A period goes to a column of its year where a header names the years over the row (the newer period to the latest
 * year), and the order of a header runs from its first year to the first different one. A header row starts a new
 * block unless it names a quarter beside a longer period ("Nine months ended 2016 | Nine months ended 2015" starts the
 * nine months; "3rd Quarter | Year to Date" heads the same columns again). An adjusted figure equal to another
 * period's GAAP figure is a coincidence where the adjustments add up to it or the row prints that period's GAAP figure
 * itself. A side-by-side row whose last header is a variant ("As Adjusted (Constant $)") takes the header over its own
 * last figure ("As Adjusted (Reported $)"). A row's own label says basic or diluted before its heading does. A
 * breakdown whose figures add up to its total (segments) places a period by the total only, and rows named by a
 * quarter's year ("2Q 2014 Basic EPS") pair within that year. Readings the GAAP line placed outrank readings the
 * headers placed whatever their basis, in a release and in the company's decision.
 *
 * And on the a6 read (a7): a breakdown adds up to its total within half a cent for each figure it prints, and a row
 * under a header that names different periods over its figures is none: a quarter, the quarter before and the year-ago
 * quarter (Marvell's −0.20, −0.02, −0.20) or two quarters and their half year (Autodesk's 0.12, 0.13, 0.26) are periods,
 * not segments; and a figure a cent away places no quarter in a column a longer period heads (Autodesk's half year). Readings
 * placed by a GAAP figure printed to the cent outrank readings placed by one a cent away (Cadence's trend tables on the
 * former revenue standard print 0.26 for the quarter filed as 0.27). The running text is read across a line break that
 * cuts a sentence, and a box of highlights gives the figure under its label; the text never makes a basic figure of a
 * release that prints a diluted one (Regeneron 2012, Mid-America's Core FFO).
 *
 * And on the a7 read (a8): the running text is its sentences. A label followed by its figures in paragraphs of their
 * own is a table split into paragraphs, the year-ago quarter's or the nine months' reconciliation as often as a box of
 * highlights (Norfolk Southern's "$ 3.25", NextEra's "$ 3.98", GE's 2015 tables), so a7's box rule is gone. A figure
 * the release prints for a longer period ending the same day is never the quarter's, whatever that row's label (Zimmer's
 * nine months, GE's years). The text moves the trusted row's figure only onto a figure the GAAP line placed, never
 * onto another trusted measure (Mid-America's Core AFFO beside its Core FFO; Regeneron's basic figure). Where the text
 * states more than one candidate it decides nothing: the order of its figures is no guide (a fourth quarter's release
 * states the year first, and most releases the GAAP figure before the adjusted one: Emerson 2017, GE 2020). An
 * adjusted column in reported currency ("As Adjusted (Reported $)") is adjusted, not the GAAP line (Ralph Lauren,
 * read since a6 but dropped). A footnote mark printed in a cell of its own after a row's last figure is no figure
 * (Cencora's "$ 3.73 | 2", read as 2.00 since a2).
 */
import { canonicalLabel, daysBetween, detectPeriodColumns, extractCandidateRows, parseExhibitHtml, parsePrintedNumber, type RawTable, type StatementColumn } from "./flash-html";

export const ADJUSTED_EPS_VERSION = "a8";

/** Words that name an adjusted basis; a "non-operating" or "non-core" item names none ("non-GAAP" does). */
const ADJUSTED = /(?<!\bnon[- ]?)\b(adjusted|non[- ]?gaap|core|operating|normalized|comparable|underlying|economic|ongoing|excluding)\b/i;
const PER_SHARE = /\b(?:e\.?p\.?s\.?|(?:earnings|income|loss|profit)(?:\s*\(loss\))?[^|]{0,70}per[^|]{0,16}share|per (?:diluted |common |basic )*share)\b/i;
/** Rows of a reconciliation that are not the adjusted figure itself (a constant-currency or pre-tax figure is a variant, not the figure). */
const NOT_THE_FIGURE = /\b(growth|change|increase|decrease|guidance|outlook|forecast|expected|range|impact|effect|adjustments?|dividends?|book value|cash flow|ffo|affo|revenue|sales|tax rate|weighted|shares used|share count|percent|margin|constant|currency|fx|before (?:income )?tax(?:es)?|pre-?tax)\b|%/i;
const GAAP_LINE = /(?<!non[- ]?)\bgaap\b|\bas reported\b|\breported\b/i;
/** A caption that gives the table's units: the rows under it are amounts, not per-share figures, unless their own label says so. */
const UNIT_CAPTION = /\b(?:millions?|thousands?|billions?)\b|\bexcept\b/i;
/** A row named by its basis under a per-share heading that is still another measure ("Operating Ratio", "Adjusted EBITDA") or a part of the reconciliation. */
const OTHER_MEASURE = /\b(?:ratio|ebitda|ebit|provision|expenses?|cash|operating income|non[- ]?operating|other)\b|\bitems excluded\b|\bexcluded from\b/i;
/** A row that names a part of the reconciliation, not its result ("Less: adjusted earnings per share attributable to trivago"). */
const COMPONENT = /^(?:less|plus|add|deduct|minus)\b/i;
/** A cell that starts another period's block in a table ("Six months ended June 30", "Year ended December 31"). */
const PERIOD_HEADER = /\b(?:months?|weeks?|quarters?|years?)\s+ended\b|\bytd\b|\byear[- ]to[- ]date\b|\bfull[- ]year\b/i;
/** A cell that names a quarter ("Three Months Ended", "Three and Nine Months", "13 weeks", "3rd Quarter", "Q2 FY09", "1Q12", "QTR 2"). */
const QUARTER_NAME = /\b(?:three|3)\b[^|]{0,16}?\bmonths?\b|\b(?:twelve|thirteen|sixteen|12|13|16)[- ]+weeks?\b|\bquarters?\b|\bqtd\b|\bqtrs?\b|\bq[1-4]\b|\b[1-4]q(?:\d{2}|\d{4})?\b/i;
/** A cell that names a period longer than a quarter ("Nine Months Ended", "Year to Date", "52 weeks", "Full Year", "Year Ended"). */
const LONGER_NAME = /\b(?:six|nine|twelve|6|9|12)[- ]+months?\b|\b(?:twenty[- ]six|thirty[- ]nine|fifty[- ]two|fifty[- ]three|24|26|28|36|39|40|52|53)[- ]+weeks?\b|\byear[- ]to[- ]date\b|\bytd\b|\bfull[- ]year\b|\byears?\s+ended\b|\bfiscal\s+year\b/i;
/** A note that an adjusted column is in reported currency ("As Adjusted (Reported $)"): no GAAP column for all its "reported". */
const CURRENCY_NOTE = /\(\s*reported\s*(?:\$|currency|dollars?)\s*\)/i;
/**
 * An adjusted figure this many times the period's GAAP figure (and above the floor) is an amount, not earnings per
 * share: no reconciliation moves a per-share figure that far.
 */
const PLAUSIBLE_TIMES = 40;
const PLAUSIBLE_FLOOR = 10;
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
  how: "gaap_column" | "gaap_block" | "gaap_row" | "gaap_table" | "period_header";
  /** The GAAP figure that placed the period was printed a cent from the known one: readings placed to the cent outrank it. */
  near?: true;
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

/** The words and per-share phrases of a sentence that states an adjusted per-share figure ("adjusted EPS of $1.92"). */
const SAID_ADJUSTED = /\b(adjusted|non[- ]?gaap|core|operating|normalized|comparable|underlying|ongoing|excluding)\b/i;
const SAID_PER_SHARE = /\bE\.?P\.?S\.?\b|per (?:diluted |common )*share|a share/i;
const SAID_FIGURE = /(?<![\d.,])\$?\s?\(?(\d{1,3}\.\d{2})\)?(?![\d%])(?!\s*(?:%|percent|million|billion|thousand))/gi;
/** The end of a line that a sentence goes on from: no closing mark, or a word that needs the next one ("... Earnings per"). */
const SENTENCE_END = /[.!?:;"”)\]]\s*$/;
const OPEN_WORD = /\b(?:per|of|and|or|to|a|an|the|from|by|for|in|on|at|with|was|were|is|are)\s*$/i;
/**
 * The per-share figures a release's running text (its sentences, not its tables) states beside an adjusted word, in
 * cents without sign and in the order the text first states them: the company's own words, which choose between rows
 * that print different figures for the quarter. A sentence a line break cut in two is read whole ("... or $1.47 per
 * diluted" / "share, in the fourth quarter": Regeneron). A label whose figures follow as paragraphs of their own is a
 * table split into paragraphs, not a sentence ("Adjusted diluted earnings per share" / "$" / "3.25": Norfolk Southern's
 * year-ago quarter), and gives nothing.
 */
export function statedAdjustedFigures(paragraphs: string[]): number[] {
  const out: number[] = [];
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const previous = lines[lines.length - 1];
    const goesOn = previous !== undefined && !previous.includes(" | ") && !paragraph.includes(" | ") && !SENTENCE_END.test(previous) && (/^[a-z]/.test(paragraph) || OPEN_WORD.test(previous));
    if (goesOn) lines[lines.length - 1] = `${previous} ${paragraph}`;
    else lines.push(paragraph);
  }
  for (const line of lines) {
    if (line.length <= 40 || line.includes(" | ") || !SAID_ADJUSTED.test(line) || !SAID_PER_SHARE.test(line)) continue;
    for (const match of line.matchAll(SAID_FIGURE)) {
      const cents = Math.round(Number(match[1]) * 100);
      if (!out.includes(cents)) out.push(cents);
    }
  }
  return out;
}

/** True when a row label (with the headings above it) names an adjusted per-share figure itself. */
export function isAdjustedEpsLabel(label: string, headings: string[] = []): boolean {
  // "As Adjusted (Reported $)" is the adjusted column in reported currency, not the GAAP line
  const text = canonicalLabel(label.replace(CURRENCY_NOTE, ""));
  if (!PER_SHARE.test(text) || NOT_THE_FIGURE.test(text) || GAAP_LINE.test(text) || COMPONENT.test(text)) return false;
  if (ADJUSTED.test(text)) return true;
  // an unmarked "diluted earnings per share" under a heading "Non-GAAP" or "Adjusted"; a heading "GAAP" takes it away
  const heading = headings.at(-1);
  return heading !== undefined && ADJUSTED.test(heading) && !GAAP_LINE.test(canonicalLabel(heading)) && !NOT_THE_FIGURE.test(canonicalLabel(heading));
}

/**
 * A period the release reports, with the GAAP earnings per diluted share known for it: `gaap` holds its first report
 * (as filed, and moved across later splits), `later` the figures later filings gave for it (restated, recast, or
 * mis-keyed: a later version can repeat the next year's figure), which place a printed figure only where no first
 * report is as near. `computed` when the first report is no filed figure but computed (a fourth quarter from the
 * year): a release may print it a cent away.
 */
export interface EpsAnchor { months: number; periodEnd: string; gaap: number[]; later?: number[]; computed?: boolean }

/** A row's label, printed numbers in order (a dash keeps its place as null) and the grid column of each number. */
interface PlainRow { rowIndex: number; label: string; heading: string | null; values: Array<number | null>; columns: number[]; texts: number; inner: string[] }

/** Every row of a table as its label and its printed numbers in order (a dash keeps its place as null); no period logic. */
function plainRows(table: RawTable): PlainRow[] {
  const out: PlainRow[] = [];
  let heading: string | null = null;
  table.grid.forEach((row, rowIndex) => {
    const cells = row.map((cell, col) => ({ text: cell.text, col })).filter((item, col) => col === 0 || row[col] !== row[col - 1]).filter((item) => item.text !== "");
    if (!cells.length) return;
    let label = "";
    const values: Array<number | null> = [], columns: number[] = [];
    let pendingNegative = false, texts = 0, previous = "";
    const inner: string[] = [];
    for (const [index, { text, col }] of cells.entries()) {
      if (/^[$]+$/.test(text)) continue;
      if (text === "(" || text === "$(" || text === "$ (") { pendingNegative = true; continue; }
      if (text === ")" || text === "%" || text === ")%") { if (text.includes(")") && values.length && values[values.length - 1] !== null) values[values.length - 1] = -Math.abs(values[values.length - 1]!); continue; }
      // a footnote mark in a cell of its own after the row's last figure is no figure ("$ 3.73 | 2": Cencora)
      if (index === cells.length - 1 && /^\d$/.test(text) && /\.\d/.test(previous)) continue;
      const parsed = parsePrintedNumber(text);
      if (!parsed) { texts++; if (!label && !values.length) label = text; else if (values.length) inner.push(text); continue; }
      values.push(parsed.value === null ? null : pendingNegative ? -Math.abs(parsed.value) : parsed.value);
      columns.push(col);
      pendingNegative = false;
      previous = text;
    }
    if (!label) return;
    if (!values.some((value) => value !== null)) { if (texts === 1) heading = label; out.push({ rowIndex, label, heading: null, values: [], columns: [], texts, inner }); return; }
    out.push({ rowIndex, label, heading, values, columns, texts, inner });
  });
  return out;
}

const isGaapEpsLabel = (label: string) => { const text = canonicalLabel(label); return PER_SHARE.test(text) && !NOT_THE_FIGURE.test(text) && (GAAP_LINE.test(text) || !ADJUSTED.test(text)); };
/**
 * A computed GAAP figure (a fourth quarter from the year's net income and shares, a figure moved across a split) may be
 * printed a cent away, and so may a row of earnings from continuing operations against the known figure of all
 * operations (Dover's 1.76 against 1.75).
 */
const ANCHOR_CENTS = 0.0101;
/** Otherwise a figure filed to the cent is printed to the cent. */
const HALF_CENT = 0.0051;
const CONTINUING = /\bcontinuing\b/i;
const toleranceOf = (known: number, loose: boolean) => (!loose && Math.abs(known * 100 - Math.round(known * 100)) < 1e-6 ? HALF_CENT : ANCHOR_CENTS);
/**
 * How near a printed figure is to a period's known figures: [distance, 0 for the first report or 1 for a later
 * version], or null. `strict` holds each known figure to its own tolerance; otherwise a first report may be a cent away.
 */
function nearness(value: number, anchor: EpsAnchor, loose: boolean, strict: boolean): [number, number] | null {
  let best: [number, number] | null = null;
  const known: Array<[number, number]> = [...anchor.gaap.map((figure): [number, number] => [figure, 0]), ...(strict ? anchor.later ?? [] : []).map((figure): [number, number] => [figure, 1])];
  for (const [figure, rank] of known) {
    const distance = Math.abs(value - figure);
    if (distance > (strict ? toleranceOf(figure, loose || anchor.computed === true) : ANCHOR_CENTS)) continue;
    if (best === null || distance < best[0] - 1e-9 || (Math.abs(distance - best[0]) <= 1e-9 && rank < best[1])) best = [distance, rank];
  }
  return best;
}
/**
 * The periods a printed GAAP figure may belong to: the nearest one within each known figure's own tolerance, a first
 * report before a later version as near (a year-ago quarter a cent away from this quarter's figure must not pass for
 * it, nor a later version of the year-ago quarter that repeats this quarter's figure); several when they tie. Only
 * where none is that near, the nearest first report a cent away (`strict` false). `loose` for a row of continuing
 * operations; `fits` leaves out periods the column cannot hold.
 */
function placeOf(value: number | null, anchors: EpsAnchor[], loose = false, fits: (anchor: EpsAnchor) => boolean = () => true): { anchors: EpsAnchor[]; strict: boolean } | null {
  if (value === null) return null;
  for (const strict of [true, false]) {
    let best: [number, number] | null = null, winners: EpsAnchor[] = [];
    for (const anchor of anchors) {
      if (!fits(anchor)) continue;
      const near = nearness(value, anchor, loose, strict);
      if (near === null) continue;
      const order = best === null ? -1 : Math.abs(near[0] - best[0]) > 1e-9 ? near[0] - best[0] : near[1] - best[1];
      if (order < 0) { best = near; winners = [anchor]; } else if (order === 0) winners.push(anchor);
    }
    if (winners.length) return { anchors: winners, strict };
  }
  return null;
}
/** The one period a printed GAAP figure belongs to, or null when none or several do; a figure a cent away only in a quarter's table (`quarter`), and then `near`. */
function anchorOf(value: number | null, anchors: EpsAnchor[], loose = false, quarter = false): { anchor: EpsAnchor; near: boolean } | null {
  const place = placeOf(value, anchors, loose);
  return place !== null && place.anchors.length === 1 && (place.strict || quarter) ? { anchor: place.anchors[0], near: !place.strict } : null;
}
/** Where a row of GAAP figures places each period (its columns), and the periods it placed by a figure a cent from the known one. */
interface Placement { columns: Map<EpsAnchor, number[]>; near: Set<EpsAnchor> }
/**
 * The columns where a row of GAAP figures prints each period's known figure. A figure two periods share goes to the
 * one not printed elsewhere in the row; two such figures, printed in two places, are told apart by order: the newer
 * period first, unless the table's year header runs the other way (`order` -1). Where a header names the year over
 * each figure (`years`), the newest period goes to a column of the latest year and an older one to an earlier year.
 * A figure a cent from a period's known one places it only where the row prints no figure of that period to the cent,
 * in a column whose year fits the years the other periods' columns carry and that no longer period heads (`longer`),
 * and only in a row of quarters: another
 * period placed right beside it, or the table names the quarter (`quarter`) and it is the row's own figure (the first,
 * or the last where the years run from the older).
 */
function columnsOf(values: Array<number | null>, anchors: EpsAnchor[], order = 1, loose = false, quarter = false, periods: Array<HeaderPeriod | null> = [], longer: boolean[] = []): Placement {
  const placed = new Map<EpsAnchor, number[]>();
  const add = (anchor: EpsAnchor, column: number) => placed.set(anchor, [...(placed.get(anchor) ?? []), column]);
  const years = periods.map((period) => period?.year ?? null);
  const known = years.filter((year): year is number => year !== null);
  const latest = known.length ? Math.max(...known) : null;
  const ends = [...new Set(anchors.map((anchor) => anchor.periodEnd))].sort();
  // a column whose header names its date holds the period ending then (not a forecast quarter beside it: Church &
  // Dwight); else, by the years, the newest period a column of the latest year and an older one an earlier year
  const fits = (column: number) => (anchor: EpsAnchor) => {
    const end = periods[column]?.end ?? null;
    if (end !== null && Math.abs(Date.parse(end) - Date.parse(anchor.periodEnd)) > PERIOD_DAYS * 86_400_000) return false;
    const year = years[column] ?? null;
    if (year === null || latest === null || Math.min(...known) === latest || ends.length < 2) return true;
    return anchor.periodEnd === ends[ends.length - 1] ? year === latest : year < latest;
  };
  const tied: Array<{ column: number; anchors: EpsAnchor[] }> = [];
  const nearby: Array<{ column: number; anchor: EpsAnchor }> = [];
  values.forEach((value, column) => {
    const place = placeOf(value, anchors, loose, fits(column));
    if (place === null) return;
    if (!place.strict) { if (place.anchors.length === 1) nearby.push({ column, anchor: place.anchors[0] }); return; }
    if (place.anchors.length === 1) add(place.anchors[0], column);
    else tied.push({ column, anchors: place.anchors });
  });
  const open = tied.filter((item) => {
    const free = item.anchors.filter((anchor) => !placed.has(anchor));
    if (free.length !== 1) return true;
    add(free[0], item.column);
    return false;
  });
  if (open.length === 2 && open.every((item) => item.anchors.length === 2 && item.anchors.every((anchor) => open[0].anchors.includes(anchor) && !placed.has(anchor)))) {
    const [newer, older] = [...open[0].anchors].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
    add(order > 0 ? newer : older, open[0].column);
    add(order > 0 ? older : newer, open[1].column);
  }
  // how the header's years label the periods (a fiscal year may carry the calendar year before or after), learned from
  // the periods placed to the cent: a 2017 trend table in a 2018 release holds no 2018 quarter (Ecolab)
  const offsets = new Set<number>();
  for (const [anchor, columns] of placed) for (const column of columns) { const year = years[column] ?? null; if (year !== null) offsets.add(year - Number(anchor.periodEnd.slice(0, 4))); }
  const yearFits = (anchor: EpsAnchor, column: number) => { const year = years[column] ?? null; return year === null || offsets.size !== 1 || year - Number(anchor.periodEnd.slice(0, 4)) === [...offsets][0]; };
  // the figures in the order printed (dashes and the other half of a row left out): a witness stands beside the figure
  const ordinal = new Map<number, number>();
  values.forEach((value, column) => { if (value !== null) ordinal.set(column, ordinal.size); });
  const beside = (a: number, b: number) => ordinal.has(a) && ordinal.has(b) && Math.abs(ordinal.get(a)! - ordinal.get(b)!) === 1;
  const printed = [...ordinal.keys()];
  const own = order > 0 ? printed[0] : printed[printed.length - 1];
  // never in a column headed by a longer period: two quarters and their half year (Autodesk's 0.12, 0.13, 0.26)
  const candidates = nearby.filter((item) => !placed.has(item.anchor) && yearFits(item.anchor, item.column) && !longer[item.column]);
  const accepted = candidates.filter((item) =>
    [...placed.entries()].some(([anchor, columns]) => anchor !== item.anchor && columns.some((column) => beside(column, item.column)))
    || candidates.some((other) => other.anchor !== item.anchor && beside(other.column, item.column))
    || (quarter && item.column === own));
  for (const item of accepted) add(item.anchor, item.column);
  return { columns: placed, near: new Set(accepted.map((item) => item.anchor)) };
}
/** The order a table's columns run in, from the nearest header row above that names two different years: -1 when the older comes first. */
function yearOrder(table: RawTable, before: number): number {
  for (let rowIndex = before - 1; rowIndex >= 0; rowIndex--) {
    const row = table.grid[rowIndex] ?? [];
    const years = row.filter((cell, col) => col === 0 || row[col] !== row[col - 1]).map((cell) => /\b((?:19|20)\d{2})\b/.exec(cell.text)?.[1]).filter((year): year is string => year !== undefined);
    const other = years.find((year) => year !== years[0]);
    if (other !== undefined) return years[0] < other ? -1 : 1;
  }
  return 1;
}
/** A header cell that names one year and no other number than a day ("2026", "September 30, 2026", "Q3 2026", "2021 *"). */
const YEAR_CELL = /^[^\d]*(?:\d{1,2}[^\d]+)?((?:19|20)\d{2})[^\d]*$/;
/** A header cell of guidance or an estimate ("(after-tax guidance) Year Ended December 31, 2021", "Q4 2026E"): no period printed. */
const ESTIMATE_CELL = /\b(?:guidance|outlook|forecast(?:ed)?|estimated?|expected|projected|targets?)\b|\b(?:19|20)\d{2}\s?E\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** A header cell's full date ("December 31, 2018", "Sept. 30, 2017"), as an ISO date. */
const DATE_CELL = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/i;
interface HeaderPeriod { year: number; end: string | null }
/** A column header is short; a longer cell is a title or a note ("Reconciliation ... for the year ending December 31, 2021": Pentair). */
const HEADER_CELL_LENGTH = 60;
const headerPeriod = (text: string): HeaderPeriod | null => {
  const year = text.length <= HEADER_CELL_LENGTH ? YEAR_CELL.exec(text) : null;
  if (!year || ESTIMATE_CELL.test(text)) return null;
  const date = DATE_CELL.exec(text);
  const end = date ? `${date[3]}-${String(MONTHS.indexOf(date[1].slice(0, 3).toLowerCase()) + 1).padStart(2, "0")}-${date[2].padStart(2, "0")}` : null;
  return { year: Number(year[1]), end };
};
/**
 * The year (and the date, where it names one) a header gives over each of a row's figures, from the nearest row above
 * whose cells name a year: by grid column where the header has a cell over every figure, else in order where it names
 * as many years as the row prints figures; nulls where the header does not line up with the row (a misaligned header
 * says nothing) and over guidance or estimates.
 */
function yearsOver(table: RawTable, row: PlainRow): Array<HeaderPeriod | null> {
  const none = row.values.map(() => null);
  for (let rowIndex = row.rowIndex - 1; rowIndex >= 0; rowIndex--) {
    const header = table.grid[rowIndex] ?? [];
    const cells = header.filter((cell, col) => col === 0 || header[col] !== header[col - 1]).map((cell) => cell.text).filter((text) => text !== "" && text.length <= HEADER_CELL_LENGTH);
    if (!cells.some((text) => YEAR_CELL.test(text))) continue;
    if (row.columns.every((col) => (header[col]?.text ?? "") !== "")) return row.columns.map((col) => headerPeriod(header[col].text));
    const named = cells.filter((text) => YEAR_CELL.test(text)).map(headerPeriod);
    return named.length === row.values.length ? named : none;
  }
  return none;
}
/** A row of a table that prints numbers other than years: data, not a header. */
function printsNumbers(texts: string[]): boolean {
  return texts.some((text) => { const parsed = parsePrintedNumber(text); return parsed !== null && parsed.value !== null && !(Number.isInteger(parsed.value) && parsed.value >= 1900 && parsed.value <= 2099); });
}
/**
 * True when a header names different periods over a row's figures: years or dates, or period names ("Q1 | Q2 | Six
 * Months"). Such a row is a row of periods, never a breakdown of segments, however its figures add up; a header that
 * names the period beside segment names ("Three Months Ended June 30, 2014 | Regulated Distribution | ...":
 * FirstEnergy) names none over the figures.
 */
function periodsAcross(table: RawTable, row: PlainRow): boolean {
  if (new Set(yearsOver(table, row).filter((period): period is HeaderPeriod => period !== null).map((period) => `${period.year}|${period.end}`)).size > 1) return true;
  const names = (text: string) => text !== "" && text.length < 120 && (QUARTER_NAME.test(text) || LONGER_NAME.test(text));
  for (let rowIndex = row.rowIndex - 1; rowIndex >= 0; rowIndex--) {
    const header = table.grid[rowIndex] ?? [];
    const texts = header.filter((cell, col) => col === 0 || header[col] !== header[col - 1]).map((cell) => cell.text);
    if (printsNumbers(texts.filter((text) => text !== "" && text.length < 120)) || !texts.some(names)) continue;
    return new Set(row.columns.map((col) => header[col]?.text ?? "").filter(names)).size > 1;
  }
  return false;
}
/**
 * Where the nearest header row above that names a period heads a row's figure with a longer period and no quarter
 * ("Six Months Ended", "Year to Date"), by grid column: no quarter's column. All false without such a header.
 */
function longerOver(table: RawTable, row: PlainRow): boolean[] {
  for (let rowIndex = row.rowIndex - 1; rowIndex >= 0; rowIndex--) {
    const header = table.grid[rowIndex] ?? [];
    const texts = header.filter((cell, col) => col === 0 || header[col] !== header[col - 1]).map((cell) => cell.text).filter((text) => text !== "" && text.length < 120);
    if (printsNumbers(texts) || !texts.some((text) => QUARTER_NAME.test(text) || LONGER_NAME.test(text))) continue;
    return row.columns.map((col) => { const text = header[col]?.text ?? ""; return text.length < 120 && LONGER_NAME.test(text) && !QUARTER_NAME.test(text); });
  }
  return row.values.map(() => false);
}
/**
 * True when a row is a quarter's by the table's own words: its label, or else the nearest header row above that names
 * a period, or else the title, names a quarter and no longer period. Rows of numbers other than years are passed over.
 */
function namesQuarter(table: RawTable, rowIndex: number, label: string): boolean {
  const verdict = (texts: string[]): boolean | null => {
    const quarter = texts.some((text) => QUARTER_NAME.test(text)), longer = texts.some((text) => LONGER_NAME.test(text));
    return quarter || longer ? quarter && !longer : null;
  };
  const own = verdict([label]);
  if (own !== null) return own;
  for (let index = rowIndex - 1; index >= 0; index--) {
    const row = table.grid[index] ?? [];
    const texts = row.filter((cell, col) => col === 0 || row[col] !== row[col - 1]).map((cell) => cell.text).filter((text) => text !== "" && text.length < 120);
    if (printsNumbers(texts)) continue;
    const found = verdict(texts);
    if (found !== null) return found;
  }
  return verdict([table.title]) ?? false;
}
/** True when a figure read as a period's adjusted one is another period's known GAAP figure (to the cent). */
const otherPeriod = (value: number, anchor: EpsAnchor, anchors: EpsAnchor[], printed: (other: EpsAnchor) => boolean = () => false) => {
  const place = placeOf(value, anchors);
  return place !== null && place.strict && place.anchors.some((other) => other !== anchor && !printed(other));
};
const plausible = (value: number, anchor: EpsAnchor) => Math.abs(value) <= MAX_PER_SHARE && Math.abs(value) <= Math.max(PLAUSIBLE_FLOOR, PLAUSIBLE_TIMES * Math.max(0, ...[...anchor.gaap, ...(anchor.later ?? [])].map((gaap) => Math.abs(gaap))));
/** Diluted or basic by the row's own label first, then by its heading ("basic and diluted" counts as diluted). */
function basisOf(label: string, heading: string | null = null): { diluted: boolean; basic: boolean } {
  for (const text of [label, heading ?? ""]) {
    const diluted = /dilut/i.test(text), basic = /\bbasic\b/i.test(text);
    if (diluted || basic) return { diluted, basic: basic && !diluted };
  }
  return { diluted: false, basic: false };
}
/**
 * True when a row of a table between two rows starts another period's block ("Nine months ended September 30"). A
 * row naming a quarter beside a longer period ("2nd Quarter | Year to Date") heads the same columns again and starts
 * none; a row naming the same longer period for two years ("Nine months ended 2016 | Nine months ended 2015") does.
 */
function separated(table: RawTable, from: number, to: number): boolean {
  for (let rowIndex = Math.min(from, to) + 1; rowIndex < Math.max(from, to); rowIndex++) {
    const row = table.grid[rowIndex] ?? [];
    const cells = row.filter((cell, col) => col === 0 || row[col] !== row[col - 1]).map((cell) => cell.text).filter((text) => text !== "" && text.length < 120);
    // a row of one year alone starts that year's block ("2008" above the year-ago quarter's lines: IFF)
    if (cells.length && cells.every((text) => /^(?:19|20)\d{2}$/.test(text)) && new Set(cells).size === 1) return true;
    if (!cells.some((text) => PERIOD_HEADER.test(text))) continue;
    if (cells.some((text) => QUARTER_NAME.test(text)) && cells.some((text) => LONGER_NAME.test(text))) continue;
    return true;
  }
  return false;
}
/** The year a row label starts with ("2013 Non-GAAP Diluted EPS", "2Q 2014 Basic EPS"): such a row belongs to that year's lines. */
const leadingYear = (label: string) => /^\s*(?:(?:[1-4]q|q[1-4])\s*)?((?:19|20)\d{2})\b/i.exec(label)?.[1] ?? null;
/**
 * A row of a breakdown: its figures before the last add up to the last (segments and their total), within half a cent
 * for each printed figure, as rounding leaves them (Marvell's −0.20, −0.02, −0.20 of three quarters do not).
 */
const totalled = (values: Array<number | null>) => {
  const last = values[values.length - 1];
  const printed = values.filter((value) => value !== null).length;
  return values.length >= 3 && last !== null && last !== undefined && Math.abs(values.slice(0, -1).reduce<number>((sum, value) => sum + (value ?? 0), 0) - last) <= 0.005 * printed + 1e-9;
};
/** A per-share row that names basic earnings and not diluted ones: the known figures are diluted, so it is not anchored on them. */
const basicOnly = (label: string) => /\bbasic\b/i.test(label) && !/dilut/i.test(label);
/**
 * The figures of a per-share row add up as the reported figure, the adjustments and the adjusted one, the adjustments
 * added or taken off; a subtotal of the adjustments printed before the adjusted figure counts once.
 */
function addsUp(values: Array<number | null>): boolean {
  if (values.length < 3) return false;
  const first = values[0], last = values[values.length - 1];
  if (first === null || last === null) return false;
  const sum = (list: Array<number | null>) => list.reduce<number>((total, value) => total + (value ?? 0), 0);
  const gives = (adjustments: number) => Math.abs(first + adjustments - last) <= 0.0151 || Math.abs(first - adjustments - last) <= 0.0151;
  const between = values.slice(1, -1);
  if (gives(sum(between))) return true;
  const subtotal = between[between.length - 1], parts = between.slice(0, -1);
  return parts.length >= 2 && subtotal !== null && Math.abs(sum(parts) - subtotal) <= 0.0151 && gives(subtotal);
}

/**
 * Reconciliation in rows: a GAAP per-share row and an adjusted per-share row with the same number of printed figures.
 * The column of a period is the one where the GAAP row prints the GAAP figure known for that period.
 */
function anchoredRows(table: RawTable, rows: PlainRow[], anchors: EpsAnchor[]): AdjustedEpsReading[] {
  // a row may also be named by its basis alone ("GAAP", "Non-GAAP") under a heading that names the per-share measure;
  // a caption of units ("In millions, except per share amounts") names none, and a row that names another measure
  // ("Operating Ratio", "Adjusted EBITDA") or a part of the reconciliation is not the figure
  const underPerShare = (row: PlainRow) => row.heading !== null && PER_SHARE.test(canonicalLabel(row.heading)) && !NOT_THE_FIGURE.test(canonicalLabel(row.heading)) && !UNIT_CAPTION.test(row.heading) && !PER_SHARE.test(canonicalLabel(row.label));
  const basisGaap = (row: PlainRow) => underPerShare(row) && GAAP_LINE.test(canonicalLabel(row.label));
  const basisAdjusted = (row: PlainRow) => underPerShare(row) && ADJUSTED.test(row.label) && !GAAP_LINE.test(canonicalLabel(row.label)) && !NOT_THE_FIGURE.test(canonicalLabel(row.label)) && !OTHER_MEASURE.test(canonicalLabel(row.label)) && !COMPONENT.test(canonicalLabel(row.label));
  const gaapRows = rows.filter((row) => row.values.length && (basisGaap(row) || (isGaapEpsLabel(row.label) && !isAdjustedEpsLabel(row.label, row.heading ? [row.heading] : []))));
  const adjustedRows = rows.filter((row) => row.values.length && (basisAdjusted(row) || isAdjustedEpsLabel(row.label, row.heading ? [row.heading] : [])))
    .map((row) => (basisAdjusted(row) ? { ...row, label: `${row.heading} · ${row.label}`, heading: null } : row));
  const out: AdjustedEpsReading[] = [];
  const placed = new Map(gaapRows.map((row): [PlainRow, Placement] => {
    const loose = CONTINUING.test(`${row.label} ${row.heading ?? ""}`);
    // a breakdown whose total is a period's figure places that period by its total only: a segment may print the same
    // figure (FirstEnergy's transmission segment 0.15 beside the consolidated 0.16 of the quarter filed as 0.15); a row
    // under different periods is none (Autodesk's two quarters and their half year 0.12, 0.13, 0.26)
    const total = row.values.length - 1;
    const values = totalled(row.values) && placeOf(row.values[total], anchors, loose) !== null && !periodsAcross(table, row) ? row.values.map((value, index) => (index === total ? value : null)) : row.values;
    return [row, columnsOf(values, anchors, yearOrder(table, row.rowIndex), loose, namesQuarter(table, row.rowIndex, row.label), yearsOver(table, row), longerOver(table, row))];
  }));
  for (const adjusted of adjustedRows) {
    const basis = basisOf(adjusted.label, adjusted.heading);
    const year = leadingYear(adjusted.label);
    for (const anchor of anchors) {
      // the columns where some GAAP row of the same width, in the same period block (and of the same year where both
      // labels start with one), prints this period's GAAP figure
      const columns = new Set<number>();
      let exact = false;
      for (const gaap of gaapRows) {
        if (gaap.values.length !== adjusted.values.length || separated(table, gaap.rowIndex, adjusted.rowIndex)) continue;
        const gaapYear = leadingYear(gaap.label);
        if (year !== null && gaapYear !== null && year !== gaapYear) continue;
        const placement = placed.get(gaap)!, found = placement.columns.get(anchor) ?? [];
        for (const column of found) columns.add(column);
        if (found.length && !placement.near.has(anchor)) exact = true;
      }
      const figures = new Set([...columns].map((column) => adjusted.values[column]).filter((value): value is number => value !== null && plausible(value, anchor)).map((value) => Math.round(value * 100)));
      if (figures.size !== 1) continue;
      const value = [...figures][0] / 100;
      out.push({
        file: table.sourceFile, tableIndex: table.tableIndex, rowIndex: adjusted.rowIndex, label: adjusted.label, heading: adjusted.heading, ...basis,
        months: anchor.months, periodEnd: anchor.periodEnd, value, raw: String(value), how: "gaap_column", ...(exact ? {} : { near: true as const }),
      });
    }
  }
  return out;
}

/**
 * Reconciliation in columns: the measures are the columns (one of them a per-share figure, the last), and the rows
 * are "Reported (GAAP)", the adjustments and "Comparable (Non-GAAP)", one such block per period. The block of a period
 * is the one whose GAAP row prints the GAAP figure known for it in the per-share column. A block runs from its GAAP row
 * to the next GAAP row or row of measure names, and its adjusted figure is its last adjusted row: the adjustments
 * between may be named "excluding ..." too.
 */
function anchoredColumns(table: RawTable, rows: PlainRow[], anchors: EpsAnchor[]): AdjustedEpsReading[] {
  const out: AdjustedEpsReading[] = [];
  let perShareLast = false, gaapRow: PlainRow | null = null, adjustedRow: PlainRow | null = null, header = "";
  const close = (gaap: PlainRow | null, adjusted: PlainRow | null) => {
    if (gaap === null || adjusted === null) return;
    const last = adjusted.values[adjusted.values.length - 1]!;
    const place = anchorOf(gaap.values[gaap.values.length - 1], anchors, CONTINUING.test(header), namesQuarter(table, gaap.rowIndex, gaap.label));
    if (place === null || !plausible(last, place.anchor)) return;
    out.push({
      file: table.sourceFile, tableIndex: table.tableIndex, rowIndex: adjusted.rowIndex, label: `${adjusted.label} · ${header}`, heading: null, diluted: /dilut/i.test(header), basic: /\bbasic\b/i.test(header) && !/dilut/i.test(header),
      months: place.anchor.months, periodEnd: place.anchor.periodEnd, value: last, raw: String(last), how: "gaap_block", ...(place.near ? { near: true as const } : {}),
    });
  };
  for (const row of rows) {
    if (!row.values.length) {
      // a row of measure names: several texts, the last one a per-share measure
      if (row.texts >= 3) {
        close(gaapRow, adjustedRow);
        const cells = table.grid[row.rowIndex].filter((cell, col) => col === 0 || table.grid[row.rowIndex][col] !== table.grid[row.rowIndex][col - 1]).map((cell) => cell.text).filter((text) => text !== "");
        perShareLast = PER_SHARE.test(canonicalLabel(cells[cells.length - 1])) && !NOT_THE_FIGURE.test(canonicalLabel(cells[cells.length - 1]));
        header = cells[cells.length - 1];
        gaapRow = null;
        adjustedRow = null;
      }
      continue;
    }
    if (!perShareLast) continue;
    const text = canonicalLabel(row.label), last = row.values[row.values.length - 1];
    if (PER_SHARE.test(text)) continue;                      // a row layout, not this one
    if (GAAP_LINE.test(text)) { close(gaapRow, adjustedRow); gaapRow = row; adjustedRow = null; continue; }
    if (!gaapRow || !ADJUSTED.test(text) || NOT_THE_FIGURE.test(text) || OTHER_MEASURE.test(text) || COMPONENT.test(text) || last === null || Math.abs(last) > MAX_PER_SHARE) continue;
    adjustedRow = row;
  }
  close(gaapRow, adjustedRow);
  return out;
}

/**
 * Reconciliation across one row: the per-share row itself carries "as reported", the adjustments and "as adjusted"
 * side by side, under column headers that say so (Abbott, Clorox, Kimberly-Clark). The row belongs to the period whose
 * GAAP figure its first number is; its last number is the adjusted figure when the last column header of the header
 * rows above says adjusted, and, where the adjustments are printed between them, when GAAP and the adjustments give it
 * to the cent (added, or taken off where the table prints the charges removed as negatives).
 */
function anchoredAcross(table: RawTable, rows: PlainRow[], anchors: EpsAnchor[]): AdjustedEpsReading[] {
  const out: AdjustedEpsReading[] = [];
  const adjustedHeader = (text: string) => { const plain = canonicalLabel(text.replace(CURRENCY_NOTE, "")); return ADJUSTED.test(plain) && !GAAP_LINE.test(plain) && !NOT_THE_FIGURE.test(plain) && !PER_SHARE.test(plain); };
  // the header rows above the data rows form one block: "GAAP Results | Adjustments | Adjusted Results (Non-GAAP)"
  // may be followed by a row naming the adjustments, whose last cell is not the adjusted column's
  let lastHeader: string | null = null, gaapHeader = false, afterData = false, headerRows: number[] = [];
  for (const row of rows) {
    if (!row.values.length) {
      if (row.texts >= 2) {
        if (afterData) { lastHeader = null; gaapHeader = false; afterData = false; headerRows = []; }
        headerRows.push(row.rowIndex);
        const cells = table.grid[row.rowIndex].filter((cell, col) => col === 0 || table.grid[row.rowIndex][col] !== table.grid[row.rowIndex][col - 1]).map((cell) => cell.text).filter((text) => text !== "");
        if (adjustedHeader(cells[cells.length - 1])) lastHeader = cells[cells.length - 1];
        if (cells.slice(0, -1).some((cell) => GAAP_LINE.test(canonicalLabel(cell)))) gaapHeader = true;
      }
      continue;
    }
    afterData = true;
    // where the last header names a variant ("As Adjusted (Constant $)"), the header over the row's own last figure
    // decides ("As Adjusted (Reported $)", the variant's columns left empty for the per-share row)
    const over = headerRows.map((index) => table.grid[index]?.[row.columns[row.columns.length - 1]]?.text ?? "").reverse().find((text) => text !== "") ?? null;
    const header = lastHeader ?? (over !== null && adjustedHeader(over) ? over : null);
    if (!header || !gaapHeader || row.values.length < 2 || row.values.length > 6 || !isGaapEpsLabel(row.label) || isAdjustedEpsLabel(row.label) || basicOnly(row.label)) continue;
    const first = row.values[0], last = row.values[row.values.length - 1];
    if (first === null || last === null) continue;
    if (row.values.length > 2 && !addsUp(row.values)) continue;
    // with nothing between them to add up, the last figure is no other period's GAAP figure (a quarter and its
    // year-ago quarter under a header far above)
    const place = anchorOf(first, anchors, CONTINUING.test(row.label), namesQuarter(table, row.rowIndex, row.label));
    if (place === null || !plausible(last, place.anchor) || (row.values.length === 2 && otherPeriod(last, place.anchor, anchors))) continue;
    out.push({
      file: table.sourceFile, tableIndex: table.tableIndex, rowIndex: row.rowIndex, label: `${row.label} · ${header}`, heading: null, ...basisOf(row.label),
      months: place.anchor.months, periodEnd: place.anchor.periodEnd, value: last, raw: String(last), how: "gaap_row", ...(place.near ? { near: true as const } : {}),
    });
  }
  return out;
}

/**
 * The cells of a header row that name a basis, in order: true for adjusted, false for GAAP; and whether the row names
 * nothing else but a caption of units (no column of adjustments or charges between them).
 */
function basisCells(table: RawTable, rowIndex: number): { bases: boolean[]; onlyBases: boolean } {
  const row = table.grid[rowIndex];
  const texts = row.filter((cell, col) => col === 0 || row[col] !== row[col - 1]).map((cell) => canonicalLabel(cell.text)).filter((text) => text !== "" && text.length < 60);
  const named = texts.map((text) => (GAAP_LINE.test(text) ? false : ADJUSTED.test(text) && !NOT_THE_FIGURE.test(text) ? true : null));
  return { bases: named.filter((basis): basis is boolean => basis !== null), onlyBases: named.every((basis, index) => basis !== null || UNIT_CAPTION.test(texts[index])) };
}

/**
 * GAAP and adjusted figures inside one per-share row, told apart by the column headers: the first half GAAP and the
 * second half adjusted (Broadcom; Procter & Gamble's summary names the second half inside the row), or GAAP and
 * adjusted in turn (Oracle, Fortinet, Carrier). The adjusted figure of a period is the one in the place that answers
 * to the place where the row prints the period's known GAAP figure. Halves need a header that names the two bases
 * and nothing else: "GAAP | Charges | Credits | Non-GAAP" is a row of reported, adjustments and adjusted side by
 * side, and so is any row whose figures add up that way (anchoredAcross reads those).
 */
function anchoredWithinRow(table: RawTable, rows: PlainRow[], anchors: EpsAnchor[]): AdjustedEpsReading[] {
  const out: AdjustedEpsReading[] = [];
  let header: { bases: boolean[]; onlyBases: boolean } = { bases: [], onlyBases: false };
  for (const row of rows) {
    if (!row.values.length) { if (row.texts >= 2) { const cells = basisCells(table, row.rowIndex); if (cells.bases.length >= 2) header = cells; } continue; }
    const count = row.values.length;
    if (count < 2 || !isGaapEpsLabel(row.label) || isAdjustedEpsLabel(row.label) || basicOnly(row.label) || addsUp(row.values)) continue;
    const named = row.inner.find((text) => isAdjustedEpsLabel(text)) ?? null;
    const bases = header.bases;
    let partner: ((index: number) => number | null) | null = null, basis = "";
    if (named !== null && count % 2 === 0) { partner = (index) => (index < count / 2 ? index + count / 2 : null); basis = named; }
    else if (bases.length === 2 && header.onlyBases && !bases[0] && bases[1] && count % 2 === 0 && count >= 4) { partner = (index) => (index < count / 2 ? index + count / 2 : null); basis = "Non-GAAP"; }
    else if (bases.length === count && bases.every((adjusted, index) => adjusted === (index % 2 === 1))) { partner = (index) => (index % 2 === 0 ? index + 1 : null); basis = "Non-GAAP"; }
    if (!partner) continue;
    // the GAAP figures are the ones with a partner; the others are the adjusted figures, and none of them is another
    // period's known GAAP figure that the row does not print among its GAAP figures (then it is that GAAP figure)
    const placed = columnsOf(row.values.map((value, index) => (partner!(index) === null ? null : value)), anchors, yearOrder(table, row.rowIndex), CONTINUING.test(row.label), namesQuarter(table, row.rowIndex, row.label), yearsOver(table, row), longerOver(table, row));
    for (const anchor of anchors) {
      const figures = new Set<number>();
      for (const index of placed.columns.get(anchor) ?? []) {
        const at = partner(index);
        const adjusted = at === null ? null : row.values[at];
        if (adjusted !== null && adjusted !== undefined && plausible(adjusted, anchor) && !otherPeriod(adjusted, anchor, anchors, (other) => placed.columns.has(other))) figures.add(Math.round(adjusted * 100));
      }
      if (figures.size !== 1) continue;
      const value = [...figures][0] / 100;
      out.push({
        file: table.sourceFile, tableIndex: table.tableIndex, rowIndex: row.rowIndex, label: `${row.label} · ${basis}`, heading: null, ...basisOf(row.label),
        months: anchor.months, periodEnd: anchor.periodEnd, value, raw: String(value), how: "gaap_row", ...(placed.near.has(anchor) ? { near: true as const } : {}),
      });
    }
  }
  return out;
}

/**
 * Twin tables: one headed "GAAP", the next headed "Non-GAAP", with the same rows and columns (Nvidia's summary). The
 * column of a period is where the GAAP table's per-share row prints the known GAAP figure; the adjusted figure is in
 * the same column of the same row of the non-GAAP table. A table whose header names both bases ("GAAP | Restructuring
 * | Non-GAAP") reconciles side by side (Merck): it is no twin, whatever its title.
 */
function twinTables(tables: RawTable[], anchors: EpsAnchor[]): AdjustedEpsReading[] {
  const out: AdjustedEpsReading[] = [];
  const titled = tables.map((table) => ({ table, title: canonicalLabel(table.title) }));
  const sideBySide = (table: RawTable) => plainRows(table).some((row) => { if (row.values.length || row.texts < 2) return false; const { bases } = basisCells(table, row.rowIndex); return bases.includes(false) && bases.includes(true); });
  titled.forEach(({ table, title }, index) => {
    if (title.length > 40 || !ADJUSTED.test(title) || GAAP_LINE.test(title) || NOT_THE_FIGURE.test(title)) return;
    const twin = titled.slice(Math.max(0, index - 2), index).reverse().find((other) => other.title.length <= 40 && GAAP_LINE.test(other.title));
    if (!twin || sideBySide(table) || sideBySide(twin.table)) return;
    const gaapRows = plainRows(twin.table).filter((row) => row.values.length && isGaapEpsLabel(row.label));
    for (const row of plainRows(table)) {
      if (!row.values.length || !isGaapEpsLabel(row.label)) continue;
      const same = gaapRows.find((other) => rowKey(other.label) === rowKey(row.label) && other.values.length === row.values.length);
      if (!same) continue;
      const placed = columnsOf(same.values, anchors, yearOrder(twin.table, same.rowIndex), CONTINUING.test(same.label), namesQuarter(twin.table, same.rowIndex, same.label), yearsOver(twin.table, same), longerOver(twin.table, same));
      for (const anchor of anchors) {
        const figures = new Set<number>();
        for (const column of placed.columns.get(anchor) ?? []) { const adjusted = row.values[column]; if (adjusted !== null && plausible(adjusted, anchor)) figures.add(Math.round(adjusted * 100)); }
        if (figures.size !== 1) continue;
        const value = [...figures][0] / 100;
        out.push({
          file: table.sourceFile, tableIndex: table.tableIndex, rowIndex: row.rowIndex, label: `${row.label} · ${table.title}`, heading: null, ...basisOf(row.label),
          months: anchor.months, periodEnd: anchor.periodEnd, value, raw: String(value), how: "gaap_table", ...(placed.near.has(anchor) ? { near: true as const } : {}),
        });
      }
    }
  });
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
    const basis = basisOf(row.label, row.headingPath.at(-1) ?? null);
    columns.forEach((column, index) => {
      const printed = row.values[index];
      if (!printed || printed.value === null || printed.percent || Math.abs(printed.value) > MAX_PER_SHARE) return;
      out.push({
        file: table.sourceFile, tableIndex: table.tableIndex, rowIndex: row.rowIndex, label: row.label, heading: row.headingPath.at(-1) ?? null,
        ...basis, months: column.months, periodEnd: column.periodEnd, value: printed.value, raw: printed.raw, how: "period_header",
      });
    });
  }
  return out;
}

function rowsOf(table: RawTable, expectedPeriodEnd: string, anchors: EpsAnchor[]): AdjustedEpsReading[] {
  // cheap test first: most tables of a release name no per-share figure at all
  if (!table.grid.some((row) => row.some((cell) => cell.text.length < 200 && PER_SHARE.test(cell.text)))) return [];
  const rows = plainRows(table);
  const anchored = [...anchoredRows(table, rows, anchors), ...anchoredColumns(table, rows, anchors), ...anchoredAcross(table, rows, anchors), ...anchoredWithinRow(table, rows, anchors)];
  // A period the GAAP line has settled is not read again from the column headers; the headers serve the other periods.
  const settled = new Set(anchored.map((reading) => `${reading.rowIndex}|${reading.months}|${reading.periodEnd}`));
  return [...anchored, ...headerRows(table, expectedPeriodEnd).filter((reading) => !settled.has(`${reading.rowIndex}|${reading.months}|${reading.periodEnd}`))];
}

/**
 * The figure the readings of one period agree on: the readings the GAAP line placed outrank the readings the headers
 * placed, and those it placed by a figure printed to the cent outrank those placed by one a cent away; among them
 * diluted rows decide, then unlabelled, then basic, and a rank that disagrees decides nothing.
 */
export function agreeOn(readings: AdjustedEpsReading[]): { figure: AdjustedEpsFigure | null; note: "ambiguous" | null } {
  // readings the GAAP line placed outrank readings the headers placed, whatever their rank: a header can take a full
  // year or another quarter for this one (AMD's 2010 releases: a diluted row placed by its header against the
  // unlabelled row its GAAP line placed); a GAAP figure a cent away may be another basis (Cadence's trend tables on
  // the former revenue standard)
  const placed = readings.filter((reading) => reading.how !== "period_header");
  const exact = placed.filter((reading) => !reading.near);
  const pool = exact.length ? exact : placed.length ? placed : readings;
  const ranks: Array<[AdjustedEpsFigure["basis"], AdjustedEpsReading[]]> = [
    ["diluted", pool.filter((reading) => reading.diluted)],
    ["unlabelled", pool.filter((reading) => !reading.diluted && !reading.basic)],
    ["basic", pool.filter((reading) => reading.basic)],
  ];
  const byCent = (list: AdjustedEpsReading[]) => {
    const cents = new Map<number, AdjustedEpsReading[]>();
    for (const reading of list) cents.set(Math.round(reading.value * 100), [...(cents.get(Math.round(reading.value * 100)) ?? []), reading]);
    return cents;
  };
  for (const [basis, all] of ranks) {
    if (!all.length) continue;
    const cents = byCent(all);
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
export interface StoredReading { months: number; periodEnd: string; value: number; diluted: boolean; basic: boolean; label: string; file: string; tableIndex: number; rowIndex: number; how?: AdjustedEpsReading["how"]; near?: true }
/** A release's readings, and the adjusted per-share figures its running text states (cents, unsigned, in the order the text first states them; statedAdjustedFigures). */
export interface StoredRelease { accession: string; acceptedEt: string; fiscalPeriodEnd: string; readings: StoredReading[]; stated?: number[] }

/**
 * How far a figure is borne out:
 *   confirmed   a later release prints the same figure for the period (to the cent, or after the splits in between)
 *   same_row    not printed again yet, but read from the row whose figures later releases have confirmed before
 *   restated    a later release prints another figure for the period (a recast measure, or a misread)
 *   unchecked   nothing to check it with
 * Only confirmed and same_row figures are for use.
 */
export type AdjustedEpsGrade = "confirmed" | "same_row" | "restated" | "unchecked";
/** `byText` when the release's running text chose this figure over the one the rows alone would give (or none). */
export interface DecidedFigure { value: number; grade: AdjustedEpsGrade; label: string; diluted: boolean; file: string; tableIndex: number; rowIndex: number; how: AdjustedEpsReading["how"]; laterValues: number[]; byText?: true }
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
 * among themselves (agreeOn), and the figure is used only if a later release confirms it. Where the rows give a figure
 * placed by a header that the release's running text does not state, and the text states exactly one figure of a row
 * its GAAP line placed, the text decides (`byText`); where the rows give none, the text decides if it states exactly one
 * figure of a row the GAAP line placed (of a trusted row, where it placed none). A fiscal year's figure must agree with
 * the sum of its four usable quarter figures, where they are known up to its release (within a tenth of their sizes).
 * `splits` are the company's splits (date, ratio): a later release restates an earlier quarter for them.
 */
export function decideCompany(releases: StoredRelease[], splits: Array<{ date: string; ratio: number }> = []): DecidedRelease[] {
  // Only rows whose own label says adjusted are decided on. A plain "earnings per share" row standing under an
  // adjusted heading is as often the GAAP line or a dividend line (found on the full read: Analog Devices 2017, UDR's
  // distributions), and a later release repeating it proves nothing about its meaning.
  const ordered = [...releases].sort((a, b) => a.acceptedEt.localeCompare(b.acceptedEt))
    .map((release) => ({ ...release, readings: release.readings.filter((reading) => isAdjustedEpsLabel(reading.label) && !OTHER_PER_SHARE.test(reading.label)) }));
  // every stored row of a release, whatever its label says: the longer periods it prints, which no quarter's figure is
  const byAccession = new Map(releases.map((release) => [release.accession, release.readings]));
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
  const decide = (release: StoredRelease, months: number, quarterly: number[] | null = null): { figure: DecidedFigure | null; note: string | null } => {
    const printed = own(release, months);
    if (!printed.length) return { figure: null, note: null };
    // A fiscal year is the sum of its quarters, to the rounding and the change in the share count over the year (more
    // where losses and profits alternate): where the four are known, a figure far from their sum is another period's or
    // another measure's (a year-ago quarter a header took for the year: Assurant 2025; the continuing operations beside
    // the headline: Kimberly-Clark 2025).
    const sum = quarterly?.reduce((total, value) => total + value, 0) ?? 0, scale = quarterly?.reduce((total, value) => total + Math.abs(value), 0) ?? 0;
    const readings = quarterly === null ? printed : printed.filter((reading) => Math.abs(reading.value - sum) <= Math.max(0.05, 0.1 * scale));
    if (!readings.length) return { figure: null, note: "not_the_quarters" };
    const later = laterValues(release, months);
    const grade = (value: number, row: boolean): AdjustedEpsGrade => (later.length ? (equal(value, later) ? "confirmed" : "restated") : row ? "same_row" : "unchecked");
    const figure = (reading: StoredReading, row: boolean): DecidedFigure => ({
      value: reading.value, grade: grade(reading.value, row), label: reading.label, diluted: reading.diluted, file: reading.file, tableIndex: reading.tableIndex, rowIndex: reading.rowIndex, how: reading.how ?? "period_header",
      laterValues: [...new Set(later.map((value) => Math.round(value * 1e4) / 1e4))].slice(0, 6),
    });
    // diluted rows first, then unlabelled ones, then basic ones (as agreeOn ranks them); within a rank the most often confirmed
    const rank = (reading: StoredReading) => (reading.diluted ? 0 : reading.basic ? 2 : 1);
    const byHeader = (reading: StoredReading) => (reading.how ?? "period_header") === "period_header";
    // The release's own words break a tie the rows leave, where the text states exactly one figure of a row the GAAP
    // line placed (of a trusted row, where it placed none and the rows take nothing). Where the rows take a figure
    // placed by a header that the running text does not state, only a figure of a row the GAAP line placed replaces
    // it: AMD's 2010 releases, a diluted row its header misplaced against the unlabelled row its GAAP line placed.
    // Another trusted row never replaces it: Mid-America's text states its Core AFFO, not the Core FFO of its trusted
    // row, and Regeneron's "$1.79 per basic share" its basic figure. A figure the release prints for a longer period
    // ending the same day, in any of its rows, is not the quarter's (Zimmer's nine months, GE's years, which a header
    // took for the quarter). Where the text states more than one, it decides nothing: a fourth quarter's release states
    // the year first (Emerson 2017), and most releases state the GAAP figure before the adjusted one, which the
    // unsigned figures can confuse (GE's "$(0.13)" in 2020). A figure the GAAP line placed is never overruled: a
    // release's text also states the year's figure, which a header can take for the quarter (PepsiCo, ADP). Nor does
    // the text make a basic figure of a release that prints a diluted one.
    const stated = new Set(release.stated ?? []);
    const says = (value: number) => stated.has(Math.abs(cents(value)));
    const diluted = readings.some((reading) => reading.diluted);
    const longer = new Set(months === 3 ? (byAccession.get(release.accession) ?? release.readings).filter((reading) => reading.months > 3 && nearPeriod(reading.periodEnd, release.fiscalPeriodEnd)).map((reading) => cents(reading.value)) : []);
    const byText = (taken: StoredReading | null): DecidedFigure | null => {
      if (!stated.size || (taken !== null && (says(taken.value) || !byHeader(taken)))) return null;
      const anchored = readings.filter((reading) => !byHeader(reading));
      const pool = taken !== null || anchored.length ? anchored : readings.filter((reading) => trusted(reading.label));
      const told = pool.filter((reading) => says(reading.value) && !(reading.basic && diluted) && !longer.has(cents(reading.value)));
      if (new Set(told.map((reading) => cents(reading.value))).size !== 1) return null;
      const pick = [...told].sort((a, b) => rank(a) - rank(b))[0];
      return { ...figure(pick, trusted(pick.label)), byText: true };
    };
    const rows = readings.filter((reading) => trusted(reading.label)).sort((a, b) => rank(a) - rank(b) || record.get(rowKey(b.label))!.confirmed - record.get(rowKey(a.label))!.confirmed);
    if (rows.length) {
      let best = rows.filter((reading) => rowKey(reading.label) === rowKey(rows[0].label));
      if (new Set(best.map((reading) => cents(reading.value))).size > 1) {
        // readings the GAAP line placed outrank readings the headers placed (a full year taken for the quarter by its
        // header), and those placed by a GAAP figure printed to the cent outrank those placed by one a cent away
        const anchored = best.filter((reading) => !byHeader(reading));
        const exact = anchored.filter((reading) => !reading.near);
        const pool = exact.length && exact.length < best.length ? exact : anchored.length < best.length ? anchored : [];
        if (!pool.length || new Set(pool.map((reading) => cents(reading.value))).size > 1) { const told = byText(null); return told ? { figure: told, note: null } : { figure: null, note: "ambiguous" }; }
        best = pool;
      }
      return { figure: byText(best[0]) ?? figure(best[0], true), note: null };
    }
    const agreed = agreeOn(readings.map((reading) => ({ ...reading, heading: null, raw: "", how: reading.how ?? "period_header" })));
    if (!agreed.figure) { const told = byText(null); return told ? { figure: told, note: null } : { figure: null, note: agreed.note }; }
    const reading = readings.find((item) => item.file === agreed.figure!.file && item.tableIndex === agreed.figure!.tableIndex && item.rowIndex === agreed.figure!.rowIndex)!;
    return { figure: byText(reading) ?? figure(reading, false), note: null };
  };
  const quarters = ordered.map((release) => decide(release, 3));
  // the usable quarter figures of the releases up to a release (its own and those before it), for its year: the grade
  // leans on later releases, as the trusted rows do, to tell which printed row is the year; the value stays the release's
  const quarterKnown = (end: string, until: string): number | null => {
    for (const [index, release] of ordered.entries()) {
      const figure = quarters[index].figure;
      // an earlier quarter is put on the share basis of the release that prints the year (McCormick's split of November 2020)
      if (release.acceptedEt <= until && figure && (figure.grade === "confirmed" || figure.grade === "same_row") && nearPeriod(release.fiscalPeriodEnd, end)) return figure.value / splitFactor(release.acceptedEt, until);
    }
    return null;
  };
  return ordered.map((release, index) => {
    const quarter = quarters[index];
    const parts = [0, 1, 2, 3].map((back) => quarterKnown(new Date(Date.parse(release.fiscalPeriodEnd) - Math.round(back * 91.31) * DAY).toISOString().slice(0, 10), release.acceptedEt));
    const year = decide(release, 12, parts.every((part) => part !== null) ? parts as number[] : null);
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
    readings.push(...twinTables(tables, anchors));
  }
  const at = (months: number) => readings.filter((reading) => reading.months === months && daysBetween(reading.periodEnd, expectedPeriodEnd) <= PERIOD_DAYS && daysBetween(expectedPeriodEnd, reading.periodEnd) <= PERIOD_DAYS);
  const quarter = agreeOn(at(3)), year = agreeOn(at(12));
  return { readings, quarter: quarter.figure, year: year.figure, quarterNote: quarter.note, yearNote: year.note };
}
