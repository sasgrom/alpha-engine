/**
 * A 13F filing read as filed.
 *
 * One security can stand on many rows of an information table (one row per combination of investment discretion,
 * other managers and voting authority), so a position is the SUM of its rows. Three kinds of rows are kept apart:
 * shares, principal amounts (bonds and notes) and options, whose rows state the underlying shares and their value
 * and are not a holding of shares. Values stay in the unit of the filing until `valueUnit` has decided that unit
 * from prices. Everything here is deterministic and unit-tested; the builder script does the reading.
 */
import { splitFactor } from "./fund-flows";

/** Bump when the reading of a table or cover page changes: stored per-filing results are then read again. */
export const FILED_TABLE_VERSION = 1;

export interface FiledSecurity {
  /** Nine characters, upper case. */
  cusip: string;
  /** Shares held: the sum over the share rows that carry no option marker. */
  shares: number;
  /** Their value, in the unit of the filing. */
  value: number;
  /** Value of the shares underlying the reported put and call options, in the unit of the filing. */
  puts: number;
  calls: number;
  /** Value of the rows stated as a principal amount. */
  principal: number;
}

export interface FiledTable {
  rows: number;
  /** Sum of the value column over every row, the way the cover page totals it. */
  value: number;
  securities: FiledSecurity[];
}

const PREFIX = "(?:[\\w.-]+:)?";
const element = (name: string) => new RegExp(`<${PREFIX}${name}\\s*>\\s*([^<]*)<`, "i");
const ROW_START = new RegExp(`<${PREFIX}infoTable\\s*>`, "i");
const ROW_END = new RegExp(`</${PREFIX}infoTable\\s*>`, "i");
const CUSIP = element("cusip");
const VALUE = element("value");
const AMOUNT = element("sshPrnamt");
const AMOUNT_TYPE = element("sshPrnamtType");
const PUT_CALL = element("putCall");

const text = (pattern: RegExp, block: string): string | null => {
  const match = pattern.exec(block);
  return match ? match[1].trim() : null;
};
const amount = (raw: string | null): number => {
  if (!raw) return 0;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
};

/** A CUSIP as filed, in one spelling: upper case, and the leading zeros a spreadsheet dropped put back. */
export function filedCusip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{6,9}$/.test(clean) ? clean.padStart(9, "0") : null;
}

/** Every row of an information table, summed per security. */
export function readInfoTable(xml: string): FiledTable {
  const bySecurity = new Map<string, FiledSecurity>();
  let rows = 0;
  let total = 0;
  const pieces = xml.split(ROW_END);
  // the last piece is what follows the final row
  for (let index = 0; index < pieces.length - 1; index++) {
    const start = pieces[index].search(ROW_START);
    if (start < 0) continue;
    const block = pieces[index].slice(start);
    const cusip = filedCusip(text(CUSIP, block));
    if (!cusip) continue;
    const value = amount(text(VALUE, block));
    rows++;
    total += value;
    const entry = bySecurity.get(cusip) ?? bySecurity.set(cusip, { cusip, shares: 0, value: 0, puts: 0, calls: 0, principal: 0 }).get(cusip)!;
    const option = (text(PUT_CALL, block) ?? "").toUpperCase();
    if (option.startsWith("PUT")) entry.puts += value;
    else if (option.startsWith("CALL")) entry.calls += value;
    else if ((text(AMOUNT_TYPE, block) ?? "SH").toUpperCase() === "PRN") entry.principal += value;
    else {
      entry.shares += amount(text(AMOUNT, block));
      entry.value += value;
    }
  }
  return { rows, value: total, securities: [...bySecurity.values()] };
}

export type AmendmentKind = "RESTATEMENT" | "NEW HOLDINGS" | "UNKNOWN";

export interface FiledCover {
  /** 13F-HR or 13F-HR/A. */
  form: string | null;
  /** Quarter end the report is for, as an ISO date. */
  period: string | null;
  /** Null for an original report. */
  amendment: AmendmentKind | null;
  amendmentNo: number | null;
  manager: string | null;
  signed: string | null;
  declaredRows: number | null;
  declaredValue: number | null;
}

const isoDate = (raw: string | null): string | null => {
  const match = raw?.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  return match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : null;
};
const whole = (raw: string | null): number | null => {
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
};
const unescape = (raw: string | null): string | null =>
  raw === null ? null : raw.replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** The cover page of a filing (primary_doc.xml): what quarter it is for and whether it replaces or adds. */
export function readCoverPage(xml: string): FiledCover {
  const form = text(element("submissionType"), xml);
  const amended = /^(true|y|yes|1)$/i.test(text(element("isAmendment"), xml) ?? "") || /\/A$/i.test(form ?? "");
  const kind = (text(element("amendmentType"), xml) ?? "").toUpperCase();
  const manager = new RegExp(`<${PREFIX}filingManager\\s*>\\s*<${PREFIX}name\\s*>\\s*([^<]*)<`, "i").exec(xml);
  return {
    form,
    period: isoDate(text(element("periodOfReport"), xml)) ?? isoDate(text(element("reportCalendarOrQuarter"), xml)),
    amendment: !amended ? null : kind === "RESTATEMENT" || kind === "NEW HOLDINGS" ? kind : "UNKNOWN",
    amendmentNo: whole(text(element("amendmentNo"), xml)),
    manager: unescape(manager ? manager[1] : null),
    signed: isoDate(text(element("signatureDate"), xml)),
    declaredRows: whole(text(element("tableEntryTotal"), xml)),
    declaredValue: whole(text(element("tableValueTotal"), xml)),
  };
}

export interface ValueUnit {
  /** Dollars per unit of the value column: 1, or 1000 when the filing states thousands of dollars. */
  dollars: 1 | 1000;
  /** Shares per unit of the share column: 1, or 1000 for the rare filer that states thousands of shares. */
  shares: 1 | 1000;
}

/**
 * The units of one filing, decided from prices. Each ratio is a security's price as filed (value ÷ shares) over
 * its known price in dollars. Filers were told to state thousands of dollars until the reports for 2022 and whole
 * dollars since; some did the opposite, so the date cannot decide. The middle ratio does: about 1 is dollars,
 * about 1/1000 is thousands of dollars, about 1000 is dollars with the shares stated in thousands. Anything else
 * is not a unit question and returns null.
 */
export function valueUnit(ratios: number[]): ValueUnit | null {
  const usable = ratios.filter((ratio) => Number.isFinite(ratio) && ratio > 0).sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle = usable[Math.floor(usable.length / 2)];
  const near = (target: number) => middle / target > 0.4 && middle / target < 2.5;
  if (near(1)) return { dollars: 1, shares: 1 };
  if (near(0.001)) return { dollars: 1000, shares: 1 };
  if (near(1000)) return { dollars: 1, shares: 1000 };
  return null;
}

export interface BookPosition {
  shares: number;
  /** Dollars. */
  value: number;
  puts: number;
  calls: number;
  principal: number;
}

export interface FiledPart {
  accession: string;
  amendment: AmendmentKind | null;
  amendmentNo: number | null;
  signed: string | null;
  positions: Map<string, BookPosition>;
}

/**
 * One fund's book for one quarter from all its filings for that quarter: the original report first, then the
 * amendments in their own order. A restatement replaces the book; new holdings add to it. What an amendment calls
 * itself is not enough: some filers send the whole report again, with a few rows more, as "new holdings", and adding
 * it would double the book. So an amendment that repeats at least 80% of the securities already in the book
 * replaces it, whatever its label. A second original for the same quarter replaces the first.
 */
export function mergeFiledParts(parts: FiledPart[]): { book: Map<string, BookPosition>; used: string[] } {
  const rank = (part: FiledPart) => (part.amendment === null ? 0 : 1);
  const ordered = [...parts].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.amendmentNo ?? Number.MAX_SAFE_INTEGER) - (b.amendmentNo ?? Number.MAX_SAFE_INTEGER) ||
      (a.signed ?? "").localeCompare(b.signed ?? "") ||
      a.accession.localeCompare(b.accession),
  );
  let book = new Map<string, BookPosition>();
  let used: string[] = [];
  for (const part of ordered) {
    let repeated = 0;
    for (const cusip of book.keys()) if (part.positions.has(cusip)) repeated++;
    const replaces = part.amendment === null || part.amendment === "RESTATEMENT" || (book.size > 0 && repeated >= 0.8 * book.size);
    if (replaces) {
      book = new Map([...part.positions].map(([cusip, position]) => [cusip, { ...position }]));
      used = [part.accession];
      continue;
    }
    for (const [cusip, position] of part.positions) {
      const entry = book.get(cusip) ?? book.set(cusip, { shares: 0, value: 0, puts: 0, calls: 0, principal: 0 }).get(cusip)!;
      entry.shares += position.shares;
      entry.value += position.value;
      entry.puts += position.puts;
      entry.calls += position.calls;
      entry.principal += position.principal;
    }
    used.push(part.accession);
  }
  return { book, used };
}

/**
 * Does a security's price move like the company's stock over one pair of quarter ends? The price in the filings
 * (value ÷ shares) against the adjusted close, after allowing for a clean split. Used where only total-return
 * closes exist; with split-adjusted closes `levelRecord` is the sharper test.
 */
export function movesWith(securityBefore: number, securityNow: number, adjustedBefore: number, adjustedNow: number, tolerance = 0.06): boolean {
  if (!(securityBefore > 0 && securityNow > 0 && adjustedBefore > 0 && adjustedNow > 0)) return false;
  const factor = splitFactor(securityBefore, securityNow, adjustedBefore, adjustedNow) ?? 1;
  const residual = (securityNow * factor) / securityBefore / (adjustedNow / adjustedBefore);
  return Math.abs(residual - 1) <= tolerance;
}

export function middle(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

// ---------------------------------------------------------------------------
// which security is which company: price levels
// ---------------------------------------------------------------------------
/** A single stock split as a ratio of shares after to shares before. */
const SINGLE_SPLITS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 50];
/** Splits that follow each other multiply: every product of up to three single splits, up to 100-for-1. */
const CLEAN_LEVELS: number[] = (() => {
  const levels = new Set<number>([1]);
  for (const a of SINGLE_SPLITS) {
    levels.add(a);
    levels.add(1 / a);
    for (const b of SINGLE_SPLITS) {
      if (a * b <= 100) levels.add(a * b);
      for (const c of SINGLE_SPLITS) if (a * b * c <= 100) levels.add(a * b * c);
    }
  }
  return [...levels].sort((x, y) => x - y);
})();
const STEPS = [1, ...SINGLE_SPLITS, ...SINGLE_SPLITS.map((split) => 1 / split)];
const nearest = (candidates: number[], ratio: number, tolerance: number): number | null => {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return null;
  let best: number | null = null;
  let distance = tolerance;
  for (const candidate of candidates) {
    const off = Math.abs(ratio / candidate - 1);
    if (off <= distance) { best = candidate; distance = off; }
  }
  return best;
};

/**
 * A price in the filings over the split-adjusted close of the same day is the number of today's shares one share of
 * that day stands for: exactly 1 after the last split, 4 before a 4-for-1, 40 before a 4-for-1 and a 10-for-1.
 * Returns that number when the ratio is one, or null when the two prices are not the same stock.
 */
export function cleanLevel(ratio: number, tolerance = 0.006): number | null {
  return nearest(CLEAN_LEVELS, ratio, tolerance);
}

/** The change of that ratio from one quarter end to the next: 1 (nothing happened), a single split, or null. */
export function splitStep(ratio: number, tolerance = 0.006): number | null {
  return nearest(STEPS, ratio, tolerance);
}

export interface LevelRecord {
  /** Index of the latest quarter tested. */
  anchor: number;
  /** The filed price at the anchor equals the close times a split factor; false when it only sits a little above. */
  anchorExact: boolean;
  /** Quarters tested: the unbroken run of quarters ending at the anchor, and the pairs of neighbours in it. */
  periods: number;
  pairs: number;
  /** Pairs across which nothing happened but, at most, a split: the two prices kept their ratio or their distance. */
  exact: number;
  /** Those, plus pairs across which the price history was lowered by a cash payment of up to 8% of the price. */
  near: number;
  /** Today's shares per filed share, per quarter (carried over quarters without a level). */
  factors: number[];
  /** Splits seen in the books: [index of the quarter the new share basis first appears in, ratio]. */
  splits: [number, number][];
}

/**
 * Tests whether a security is a company's stock and returns its share basis per quarter. `security[i]` is the
 * price its holders report at quarter end i (null where it is not widely held), `stock[i]` the company's
 * split-adjusted close.
 *
 * For the company's stock the filed price over the close is the split factor since: 1 after the last split. The
 * latest quarter must show that. Walking back, a pair of quarters fits when the two prices kept their ratio
 * (nothing happened, or a split: the ratio steps by 2, 3, 10 …) or kept their distance in dollars. The second
 * case exists because the price history is lowered by special dividends as an amount, not as a ratio; a payment
 * between two quarter ends moves that distance by the amount paid, which counts as near. A history scaled for a
 * spin-off steps by an odd ratio once and fits before and after.
 */
export function levelRecord(security: (number | null)[], stock: (number | null)[]): LevelRecord | null {
  const tested: number[] = [];
  for (let index = 0; index < security.length; index++) if (security[index] && stock[index] && security[index]! > 0 && stock[index]! > 0) tested.push(index);
  if (!tested.length) return null;
  const anchor = tested[tested.length - 1];
  const level = security[anchor]! / stock[anchor]!;
  let start = cleanLevel(level);
  const anchorExact = start !== null;
  // cash paid out after the latest quarter end already lowers its close: the filed price then sits up to 12% above a split factor
  if (start === null) for (const candidate of CLEAN_LEVELS) if (level / candidate > 1.006 && level / candidate <= 1.12) start = candidate;
  if (start === null) return null;
  const factors = new Array<number>(security.length).fill(start);
  const splits: [number, number][] = [];
  let pairs = 0;
  let exact = 0;
  let near = 0;
  let factor = start;
  let reached = anchor;
  for (let position = tested.length - 1; position > 0; position--) {
    const later = tested[position];
    const earlier = tested[position - 1];
    // Across a gap of quarters nothing can be said (a ticker that once belonged to another company carries that
    // company's prices before the gap): the record ends here and everything earlier keeps the basis reached.
    if (later - earlier > 1) break;
    reached = earlier;
    const ratio = security[earlier]! / stock[earlier]! / (security[later]! / stock[later]!);
    const strict = splitStep(ratio);
    const step = strict ?? splitStep(ratio, 0.04) ?? 1;
    // the distance between the filed price (on today's share basis) and the close, before and after
    const change = (security[earlier]! / (factor * step) - stock[earlier]! - (security[later]! / factor - stock[later]!)) / stock[later]!;
    const isExact = strict !== null || Math.abs(change) <= 0.004;
    const isNear = isExact || (change > 0 && change <= 0.08);
    pairs++;
    if (isExact) exact++;
    if (isNear) near++;
    if (isNear && step !== 1) {
      factor *= step;
      splits.push([later, step]);
    }
    factors[earlier] = factor;
  }
  for (let index = 0; index < reached; index++) factors[index] = factor;
  return { anchor, anchorExact, periods: pairs + 1, pairs, exact, near, factors, splits: splits.reverse() };
}

/**
 * Whether a record is enough to name the company from prices alone: at least six quarters; a short record must fit
 * in every pair with an exact anchor; a long one in 60% of its pairs exactly and 85% nearly.
 */
export function levelRecordConfirms(record: LevelRecord, minimumPeriods = 6): boolean {
  if (record.periods < minimumPeriods) return false;
  if (record.pairs < 10) return record.anchorExact && record.exact === record.pairs;
  if (!record.anchorExact && record.pairs < 12) return false;
  return record.exact / record.pairs >= 0.6 && record.near / record.pairs >= 0.85;
}

/**
 * Another share class of the same company trades at a steady multiple of the main one: about 1 for classes that
 * differ in votes (they count share for share), 1,500 for Berkshire's A shares. `ratios` are the class's filed
 * price over the main security's filed price in the quarters in which both are widely held. Returns the main-class
 * shares one share stands for, or null when the ratio wanders (then it is some other security).
 */
export function classShares(ratios: number[], minimum = 12, spread = 0.15): number | null {
  const known = ratios.filter((ratio) => Number.isFinite(ratio) && ratio > 0).sort((a, b) => a - b);
  if (known.length < minimum) return null;
  if (known[Math.ceil(known.length * 0.95) - 1] / known[Math.floor(known.length * 0.05)] - 1 > spread) return null;
  const mid = known[Math.floor(known.length / 2)];
  if (mid > 0.7 && mid < 1.4) return 1;
  const unit = 10 ** (Math.floor(Math.log10(mid)) - 1);
  return Math.round(mid / unit) * unit;
}
