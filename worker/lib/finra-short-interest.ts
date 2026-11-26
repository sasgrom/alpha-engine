/**
 * FINRA's consolidated short interest: one public file per settlement date (the 15th and the last business day of a
 * month, published about seven business days later), every listed and OTC symbol in it. The raw files live unchanged
 * in the archive on D: (the folder the lab's first fetch made); this module finds the dates to ask for, reads a file,
 * and builds the desk's per-company history.
 */

export const DESK_SHORT_INTEREST_SCHEMA_VERSION = 1;
export const FINRA_SHORT_INTEREST_URL = "https://cdn.finra.org/equity/otcmarket/biweekly/";

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day));

/**
 * The file dates worth asking for between two days: for each mid-month and month-end settlement, the date itself and
 * up to three calendar days before it, weekdays only (a settlement falling on a weekend or holiday moves back).
 * Newest first. Dates after `to` are left out.
 */
export function shortInterestCandidates(from: string, to: string): string[][] {
  const groups: string[][] = [];
  const start = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`);
  for (let year = start.getUTCFullYear(), month = start.getUTCMonth(); utc(year, month, 1) <= end; month === 11 ? (year++, month = 0) : month++) {
    for (const settlement of [utc(year, month, 15), utc(year, month + 1, 0)]) {
      if (settlement < start || settlement > end) continue;
      const group: string[] = [];
      for (let back = 0; back <= 3; back++) {
        const day = new Date(settlement.getTime() - back * 86_400_000);
        if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) group.push(iso(day));
      }
      groups.push(group);
    }
  }
  return groups.reverse();
}

export interface FinraShortInterestRow {
  symbol: string;
  settlementDate: string;
  shares: number;
  averageDailyVolume: number | null;
  /** Shares short over average daily volume; null where FINRA has no volume to divide by (it prints 999.99). */
  daysToCover: number | null;
}

/** The rows of one FINRA file. A file whose header or settlement dates are not as expected is refused whole. */
export function parseFinraShortInterest(text: string): FinraShortInterestRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const cells = (line: string) => line.split("|").map((cell) => cell.replace(/^"|"$/g, ""));
  const header = cells(lines[0] ?? "");
  const at = (name: string) => { const index = header.indexOf(name); if (index < 0) throw new Error(`FINRA short interest file has no ${name} column`); return index; };
  const symbolAt = at("symbolCode"), sharesAt = at("currentShortPositionQuantity"), volumeAt = at("averageDailyVolumeQuantity"), daysAt = at("daysToCoverQuantity"), dateAt = at("settlementDate");
  const rows: FinraShortInterestRow[] = [];
  for (const line of lines.slice(1)) {
    const row = cells(line);
    const symbol = row[symbolAt]?.trim(), settlementDate = row[dateAt]?.trim(), shares = Number(row[sharesAt]);
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(settlementDate ?? "") || !Number.isFinite(shares) || row[sharesAt] === "") throw new Error(`Unreadable FINRA short interest line: ${line.slice(0, 120)}`);
    const volume = row[volumeAt] === "" ? null : Number(row[volumeAt]), days = row[daysAt] === "" ? null : Number(row[daysAt]);
    rows.push({
      symbol, settlementDate, shares,
      averageDailyVolume: volume !== null && Number.isFinite(volume) ? volume : null,
      daysToCover: days !== null && Number.isFinite(days) && days < 999 && volume !== null && volume > 0 ? days : null,
    });
  }
  const dates = new Set(rows.map((row) => row.settlementDate));
  if (rows.length === 0 || dates.size !== 1) throw new Error(`A FINRA short interest file must hold one settlement date, found ${dates.size}`);
  return rows;
}

/** FINRA writes a share class without a separator (BRKB, BFB); the registry writes BRK-B or BRK.B. */
export function finraSymbol(ticker: string): string {
  return ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A company's share count for one quarter, as filed (the desk's statements file, from the fundamentals standard). */
export interface ShareCount { end: string; filed: string; shares: number; kind: "outstanding" | "weighted average" }

export interface DeskShortInterestPoint {
  date: string; shares: number; averageDailyVolume: number | null; daysToCover: number | null;
  /**
   * Shares short / the company's share count known at the settlement date (all its share classes): the newest quarter
   * filed on or before that date, at most SHARE_COUNT_MAX_AGE_DAYS old, period-end shares outstanding where filed, else
   * the weighted average. Null without such a count, above 1, or for a company with several listed common classes
   * (FINRA counts one class, the share count all of them). Absent in files built before 2026-11-26.
   */
  shareOfShares?: number | null;
  shareCount?: ShareCount | null;
}

/**
 * Companies whose common stock trades under more than one symbol, checked by hand on 2026-11-26 against SEC
 * company_tickers_exchange (notes, preferreds and foreign OTC lines set aside): Brown-Forman BF-A/BF-B, Berkshire
 * BRK-A/BRK-B, Fox FOXA/FOX, Alphabet GOOGL/GOOG, Lennar LEN/LEN-B, McCormick MKC/MKC-V, News Corp NWSA/NWS.
 */
export const SEVERAL_LISTED_CLASSES = new Set([14693, 1067983, 1754301, 1652044, 920760, 63754, 1564708]);
export const SHARE_COUNT_MAX_AGE_DAYS = 200;

/** The share counts of a desk statements file: per quarter, period-end shares outstanding, else the weighted average. */
export function shareCountsFromStatements(file: { quarters: { end: string }[]; statements: Record<string, { code: string; cells: ({ value: number | null; filed: string } | null)[] }[]> }): ShareCount[] {
  const line = (code: string) => Object.values(file.statements).flat().find((row) => row.code === code)?.cells ?? [];
  const outstanding = line("sharesBasic"), average = line("shareswa");
  const counts: ShareCount[] = [];
  file.quarters.forEach((quarter, index) => {
    const a = outstanding[index], b = average[index];
    if (a && a.value && a.value > 0) counts.push({ end: quarter.end, filed: a.filed, shares: a.value, kind: "outstanding" });
    else if (b && b.value && b.value > 0) counts.push({ end: quarter.end, filed: b.filed, shares: b.value, kind: "weighted average" });
  });
  return counts;
}

/** The count known at a date: filed on or before it, newest quarter end first, at most SHARE_COUNT_MAX_AGE_DAYS old. */
export function shareCountAt(counts: ShareCount[], date: string): ShareCount | null {
  const oldest = new Date(Date.parse(`${date}T00:00:00Z`) - SHARE_COUNT_MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const known = counts.filter((count) => count.filed <= date && count.filed >= oldest);
  known.sort((x, y) => y.end.localeCompare(x.end) || y.filed.localeCompare(x.filed));
  return known[0] ?? null;
}

export interface DeskShortInterestFile {
  schemaVersion: typeof DESK_SHORT_INTEREST_SCHEMA_VERSION;
  source: string;
  /** The newest settlement date in the archive. */
  asOf: string;
  /** The settlement dates read, newest first. */
  settlements: string[];
  builtAt: string;
  /** FINRA symbols that two registry companies share: neither gets readings, rather than one getting the other's. */
  ambiguous: string[];
  /** Per company (CIK): its readings, newest first. */
  companies: Record<string, DeskShortInterestPoint[]>;
}

/**
 * Each company's readings over the given settlement files. A company is matched by its ticker in FINRA's spelling;
 * one without a row in a file simply has no reading for that date. A symbol two companies share is given to neither.
 */
export function buildDeskShortInterest(params: { files: FinraShortInterestRow[][]; companies: { cik: number; ticker: string }[]; builtAt: string; shareCounts?: Map<number, ShareCount[]> }): DeskShortInterestFile {
  const bySymbol = new Map<string, number>(), ambiguous = new Set<string>();
  for (const company of params.companies) {
    const symbol = finraSymbol(company.ticker);
    if (!symbol) continue;
    if (bySymbol.has(symbol) && bySymbol.get(symbol) !== company.cik) ambiguous.add(symbol);
    bySymbol.set(symbol, company.cik);
  }
  for (const symbol of ambiguous) bySymbol.delete(symbol);
  const companies: Record<string, DeskShortInterestPoint[]> = {};
  const settlements: string[] = [];
  for (const rows of params.files) {
    if (!rows.length) continue;
    if (settlements.includes(rows[0].settlementDate)) throw new Error(`The settlement ${rows[0].settlementDate} was read twice`);
    settlements.push(rows[0].settlementDate);
    for (const row of rows) {
      const cik = bySymbol.get(row.symbol);
      if (cik === undefined) continue;
      const point: DeskShortInterestPoint = { date: row.settlementDate, shares: row.shares, averageDailyVolume: row.averageDailyVolume, daysToCover: row.daysToCover };
      if (params.shareCounts) {
        const count = SEVERAL_LISTED_CLASSES.has(cik) ? null : shareCountAt(params.shareCounts.get(cik) ?? [], row.settlementDate);
        const share = count ? row.shares / count.shares : null;
        point.shareCount = count;
        point.shareOfShares = share !== null && share <= 1 ? share : null;
      }
      (companies[String(cik)] ??= []).push(point);
    }
  }
  if (!settlements.length) throw new Error("No FINRA short interest file was read");
  settlements.sort((a, b) => b.localeCompare(a));
  for (const points of Object.values(companies)) points.sort((a, b) => b.date.localeCompare(a.date));
  return { schemaVersion: DESK_SHORT_INTEREST_SCHEMA_VERSION, source: FINRA_SHORT_INTEREST_URL, asOf: settlements[0], settlements, builtAt: params.builtAt, ambiguous: [...ambiguous].sort(), companies };
}
