/**
 * Builds the quarter-end books of the tracked funds from the filed 13F tables in the local cache
 * (worker/cache/13f/<fund CIK>/<accession>.xml with its cover page <accession>.primary.xml): every row of every
 * table summed per security, in dollars, with all filings of a quarter merged (a restatement replaces the book,
 * new holdings add to it). The database table fund_holdings keeps one filed row per security and is not read.
 *
 * Which security is which company is decided by prices, not by a lookup: the price the filers report for a security
 * (value ÷ shares at a quarter end) over the company's split-adjusted close of that day is exactly 1 for the
 * company's stock, or the split factor since (4, 20, …). That ratio also puts every share count on today's split
 * basis. The stored CUSIP map only proposes candidates for securities with a short record. Another share class
 * with its own price is found by its steady price ratio to the company's main security.
 *
 * Read-only on the cache and on the database (cusip_map, companies, prices). Writes under --out
 * (default D:/research/alpha-engine/fund-books):
 *   filings/<fund CIK>/<accession>.json   one result per filing; reused while the reader version and the size and
 *                                          modification time of both source files are unchanged
 *   quarters/<quarter>.json               positions per fund and company, and what each fund filed in all
 *   manifest.json                         counts, checks, hashes of the quarter files and what was left out
 *
 * A missing cache or output drive stops the run; finished filings are kept and reused by the next run.
 *
 *   npx tsx scripts/build-fund-books.mts [--out <folder>] [--verify] [--explain <cusip,cusip>]
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getDb } from "../api/queries/connection";
import { FUND_BOOKS_SCHEMA_VERSION, type FundBookEntry, type FundBooksManifest, type FundBooksQuarter } from "../contracts/fund-books";
import { writeJsonAtomic } from "../worker/lib/json-file";
import {
  FILED_TABLE_VERSION,
  classShares,
  cleanLevel,
  levelRecord,
  levelRecordConfirms,
  mergeFiledParts,
  middle,
  movesWith,
  readCoverPage,
  readInfoTable,
  valueUnit,
  type BookPosition,
  type FiledCover,
  type FiledPart,
  type ValueUnit,
} from "../worker/lib/thirteenf-table";

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : null;
};
const CACHE = path.resolve("worker/cache/13f");
const OUT = path.resolve(argument("--out") ?? "D:/research/alpha-engine/fund-books");
const VERIFY = process.argv.includes("--verify");
const FILING_SCHEMA = 1;
/** Quarters a security must be widely held in before prices alone may name its company. */
const MATCH_PERIODS = 6;
/** Filers that make a quarter-end price of a security trustworthy. */
const MIN_FILERS = 3;

if (!existsSync(CACHE)) throw new Error(`The 13F cache ${CACHE} cannot be reached (is the D: drive connected?). Nothing was changed.`);
if (!existsSync(path.dirname(OUT))) throw new Error(`The output parent ${path.dirname(OUT)} cannot be reached (is the D: drive connected?). Nothing was changed.`);

const client = getDb().$client.promise();
const select = async <T,>(sql: string, params: unknown[] = []): Promise<T[]> => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("The fund-book build reads only");
  return (await client.query(sql, params))[0] as T[];
};
const sum = (values: Iterable<number>) => {
  let total = 0;
  for (const value of values) total += value;
  return total;
};
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const codeVersion = sha256([path.resolve("scripts/build-fund-books.mts"), path.resolve("worker/lib/thirteenf-table.ts")].map((file) => readFileSync(file, "utf8")).join("\n")).slice(0, 12);

// --- every filing, read once -----------------------------------------------------------------------------------------------
interface FilingFile {
  schema: number;
  reader: number;
  fund: number;
  accession: string;
  source: { bytes: number; modified: number; sha256: string; coverBytes: number; coverModified: number; coverSha256: string };
  cover: FiledCover;
  rows: number;
  value: number;
  cusips: string[];
  shares: number[];
  values: number[];
  puts: [number, number][];
  calls: [number, number][];
  principal: [number, number][];
}
interface Filing {
  fund: number;
  accession: string;
  cover: FiledCover;
  rows: number;
  /** Sum of the value column over all rows, in the unit of the filing. */
  value: number;
  /** Securities by id (index into `cusips`), with shares and value in the units of the filing. */
  ids: Uint32Array;
  shares: Float64Array;
  values: Float64Array;
  puts: Map<number, number>;
  calls: Map<number, number>;
  /** Totals in the unit of the filing. */
  shareValue: number;
  putsTotal: number;
  callsTotal: number;
  principal: number;
  securities: number;
  unit: ValueUnit | null;
  unitAssumed: boolean;
}

let reused = 0;
let parsed = 0;
function readFiling(fund: number, accession: string, tablePath: string, coverPath: string): FilingFile {
  const tableStat = statSync(tablePath);
  const coverStat = statSync(coverPath);
  const stored = path.join(OUT, "filings", String(fund), `${accession}.json`);
  if (existsSync(stored)) {
    let file: FilingFile | null = null;
    try { file = JSON.parse(readFileSync(stored, "utf8")) as FilingFile; } catch { file = null; } // an unreadable stored result is read again from the source
    const same =
      file !== null && file.schema === FILING_SCHEMA && file.reader === FILED_TABLE_VERSION && file.source.bytes === tableStat.size && file.source.modified === Math.floor(tableStat.mtimeMs) &&
      file.source.coverBytes === coverStat.size && file.source.coverModified === Math.floor(coverStat.mtimeMs);
    if (file !== null && same) {
      if (VERIFY && (sha256(readFileSync(tablePath)) !== file.source.sha256 || sha256(readFileSync(coverPath)) !== file.source.coverSha256)) {
        throw new Error(`The source of ${fund}/${accession} no longer matches the hash in its stored result ${stored}. The run stops so that it can be looked at.`);
      }
      reused++;
      return file;
    }
  }
  const tableBytes = readFileSync(tablePath);
  const coverBytes = readFileSync(coverPath);
  const table = readInfoTable(tableBytes.toString("utf8"));
  const sparse = (pick: "puts" | "calls" | "principal") => table.securities.flatMap((row, index): [number, number][] => (row[pick] ? [[index, row[pick]]] : []));
  const file: FilingFile = {
    schema: FILING_SCHEMA,
    reader: FILED_TABLE_VERSION,
    fund,
    accession,
    source: { bytes: tableStat.size, modified: Math.floor(tableStat.mtimeMs), sha256: sha256(tableBytes), coverBytes: coverStat.size, coverModified: Math.floor(coverStat.mtimeMs), coverSha256: sha256(coverBytes) },
    cover: readCoverPage(coverBytes.toString("utf8")),
    rows: table.rows,
    value: table.value,
    cusips: table.securities.map((row) => row.cusip),
    shares: table.securities.map((row) => row.shares),
    values: table.securities.map((row) => row.value),
    puts: sparse("puts"),
    calls: sparse("calls"),
    principal: sparse("principal"),
  };
  writeJsonAtomic(stored, file);
  parsed++;
  return file;
}

const cusips: string[] = [];
const cusipIds = new Map<string, number>();
const idOf = (cusip: string): number => {
  let id = cusipIds.get(cusip);
  if (id === undefined) {
    id = cusips.length;
    cusips.push(cusip);
    cusipIds.set(cusip, id);
  }
  return id;
};

const started = Date.now();
const filings: Filing[] = [];
const withoutCover: string[] = [];
const fundFolders = readdirSync(CACHE).filter((name) => /^\d+$/.test(name));
let seen = 0;
for (const folderName of fundFolders) {
  const folder = path.join(CACHE, folderName);
  for (const name of readdirSync(folder)) {
    if (!name.endsWith(".xml") || name.endsWith(".primary.xml")) continue;
    const accession = name.slice(0, -4);
    const coverPath = path.join(folder, `${accession}.primary.xml`);
    if (!existsSync(coverPath)) { withoutCover.push(`${folderName}/${accession}`); continue; }
    let file: FilingFile;
    try {
      file = readFiling(Number(folderName), accession, path.join(folder, name), coverPath);
    } catch (error) {
      throw new Error(`Reading ${folderName}/${name} failed (${error instanceof Error ? error.message : String(error)}). The run stops; the ${parsed} filings read so far are stored and will be reused.`);
    }
    const ids = new Uint32Array(file.cusips.length);
    for (let index = 0; index < file.cusips.length; index++) ids[index] = idOf(file.cusips[index]);
    filings.push({
      fund: file.fund, accession, cover: file.cover, rows: file.rows, value: file.value, ids, shares: Float64Array.from(file.shares), values: Float64Array.from(file.values),
      puts: new Map(file.puts.map(([index, value]) => [ids[index], value])),
      calls: new Map(file.calls.map(([index, value]) => [ids[index], value])),
      shareValue: sum(file.values), putsTotal: sum(file.puts.map((entry) => entry[1])), callsTotal: sum(file.calls.map((entry) => entry[1])), principal: sum(file.principal.map((entry) => entry[1])),
      securities: file.shares.filter((shares) => shares > 0).length,
      unit: null, unitAssumed: false,
    });
    if (++seen % 1000 === 0) console.log(`[fund-books] ${seen} filings (${parsed} read, ${reused} reused) in ${Math.round((Date.now() - started) / 1000)} s`);
  }
}
console.log(`[fund-books] ${filings.length} filings of ${fundFolders.length} funds: ${parsed} read, ${reused} reused, ${withoutCover.length} without a cover page, ${cusips.length} securities, ${Math.round((Date.now() - started) / 1000)} s`);

// what the tables add up to against what the cover pages state
const totals = { agree: 0, rowsDiffer: 0, valueThousandfold: 0, valueDiffers: 0, notStated: 0, noTable: 0, partTable: 0 };
const totalsAgree = new Map<Filing, boolean>();
/**
 * Cached files that are not the whole table. `noTable`: no row at all although the cover page states some (the
 * cache then holds a copy of the cover page: the table was filed confidentially or was not found). `partTable`:
 * under half the stated rows and a value that does not add up to the stated total either.
 */
const noTable = new Set<Filing>();
const partTable = new Set<Filing>();
for (const filing of filings) {
  const declared = filing.cover.declaredValue;
  const stated = filing.cover.declaredRows;
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, 1e-6 * Math.abs(b));
  let verdict: keyof typeof totals;
  if (declared === null || stated === null) verdict = "notStated";
  else if (stated !== filing.rows) verdict = "rowsDiffer";
  else if (close(declared, filing.value)) verdict = "agree";
  else if (close(declared * 1000, filing.value) || close(declared, filing.value * 1000)) verdict = "valueThousandfold";
  else verdict = "valueDiffers";
  if (filing.rows === 0 && (stated ?? 0) > 0) {
    noTable.add(filing);
    verdict = "noTable";
  } else if (declared !== null && declared > 0 && stated !== null && filing.rows < 0.5 * stated) {
    // the same total, or the same total stated in the other unit, means only the row count on the cover is off
    const share = filing.value / declared;
    const sameTotal = (share >= 0.5 && share <= 2) || (share * 1000 >= 0.9 && share * 1000 <= 1.1) || (share / 1000 >= 0.9 && share / 1000 <= 1.1);
    if (!sameTotal) {
      partTable.add(filing);
      verdict = "partTable";
    }
  }
  totals[verdict]++;
  totalsAgree.set(filing, verdict === "agree" || verdict === "valueThousandfold");
}

// --- the unit of each filing, from prices ------------------------------------------------------------------------------------
const usable = filings.filter((filing) => filing.cover.period !== null);
const periods = [...new Set(usable.map((filing) => filing.cover.period!))].sort();
const periodIndex = new Map(periods.map((period, index) => [period, index]));
const key = (period: number, id: number) => period * 2 ** 22 + id;
/** Middle price per quarter and security over the filers, given a way to turn a filing's value column into dollars. */
function middlePrices(dollarsOf: (filing: Filing) => number | null, minimum: number): Map<number, { price: number; holders: number }> {
  const lists = new Map<number, number[]>();
  for (const filing of usable) {
    const dollars = dollarsOf(filing);
    if (dollars === null) continue;
    const period = periodIndex.get(filing.cover.period!)!;
    const perShare = dollars / (filing.unit?.shares ?? 1);
    for (let index = 0; index < filing.ids.length; index++) {
      if (!(filing.shares[index] > 0 && filing.values[index] > 0)) continue;
      const id = key(period, filing.ids[index]);
      const list = lists.get(id);
      if (list) list.push((filing.values[index] / filing.shares[index]) * perShare);
      else lists.set(id, [(filing.values[index] / filing.shares[index]) * perShare]);
    }
  }
  const prices = new Map<number, { price: number; holders: number }>();
  for (const [id, list] of lists) if (list.length >= minimum) prices.set(id, { price: middle(list)!, holders: list.length });
  return prices;
}
// first reading: thousands of dollars in reports signed before 3 January 2023, dollars since; the middle over at least five filers is the reference
const eraGuess = (filing: Filing): 1 | 1000 => ((filing.cover.signed ?? filing.cover.period ?? "") >= "2023-01-03" ? 1 : 1000);
const firstReference = middlePrices(eraGuess, 5);
const unitCounts: Record<string, number> = {};
const unitUnknown: string[] = [];
for (const filing of usable) {
  const period = periodIndex.get(filing.cover.period!)!;
  const ratios: number[] = [];
  for (let index = 0; index < filing.ids.length; index++) {
    const reference = firstReference.get(key(period, filing.ids[index]));
    if (reference && filing.shares[index] > 0 && filing.values[index] > 0) ratios.push(filing.values[index] / filing.shares[index] / reference.price);
  }
  if (!ratios.length) {
    filing.unit = { dollars: eraGuess(filing), shares: 1 };
    filing.unitAssumed = true;
  } else filing.unit = valueUnit(ratios);
  const label = filing.unit === null ? "unknown" : `${filing.unitAssumed ? "assumed " : ""}${filing.unit.dollars === 1000 ? "thousands" : "dollars"}${filing.unit.shares === 1000 ? ", shares in thousands" : ""} · ${eraGuess(filing) === 1 ? "signed 2023 or later" : "signed before 2023"}`;
  unitCounts[label] = (unitCounts[label] ?? 0) + 1;
  if (filing.unit === null) unitUnknown.push(`${filing.fund}/${filing.accession} ${filing.cover.period} (${filing.cover.manager ?? "?"}; middle ratio ${middle(ratios)?.toPrecision(3)}, ${ratios.length} securities)`);
}
/** The price the books imply for a security at a quarter end, with the number of filers behind it. */
const implied = middlePrices((filing) => filing.unit?.dollars ?? null, 1);
console.log(`[fund-books] units decided: ${JSON.stringify(unitCounts)}`);

// --- which security is which company -----------------------------------------------------------------------------------------
const companies = new Map<number, string>();
for (const row of await select<{ cik: number; ticker: string }>("SELECT cik, ticker FROM companies")) companies.set(Number(row.cik), row.ticker);
const tickerOf = (company: number) => companies.get(company) ?? String(company);
// closes at the quarter ends: Schwab history carries the price alone (splits taken out, dividends not); the stored total-return closes are the fallback
const priceOnly = new Map<number, (number | null)[]>();
const totalReturn = new Map<number, (number | null)[]>();
{
  const rows = await select<{ cik: number; d: string; close: number; source: string }>(
    "SELECT cik, DATE_FORMAT(date,'%Y-%m-%d') d, close, source FROM prices WHERE source IN ('schwab-hist','schwab','stooq') AND cik > 0 AND close IS NOT NULL AND date >= DATE_SUB(?, INTERVAL 12 DAY) AND MONTH(date) IN (3,6,9,12) AND DAY(date) >= 18",
    [periods[0]],
  );
  // per company and quarter end: the latest close on or before it, at most ten days old
  const latest = new Map<string, { d: string; close: number }>();
  for (const row of rows) {
    const quarterEnd = periods.find((period) => period.slice(0, 7) === row.d.slice(0, 7));
    if (!quarterEnd || row.d > quarterEnd || (Date.parse(quarterEnd) - Date.parse(row.d)) / 86_400_000 > 10) continue;
    const kind = row.source === "stooq" ? "t" : row.source === "schwab-hist" ? "p" : "q";
    const id = `${kind}|${row.cik}|${quarterEnd}`;
    const held = latest.get(id);
    if (!held || row.d > held.d) latest.set(id, { d: row.d, close: Number(row.close) });
  }
  for (const cik of companies.keys()) {
    const series = (kind: string) => periods.map((period) => latest.get(`${kind}|${cik}|${period}`)?.close ?? null);
    const history = series("p");
    const recent = series("q");
    const combined = history.map((close, index) => close ?? recent[index]);
    if (combined.some((close) => close !== null)) priceOnly.set(cik, combined);
    const total = series("t");
    if (total.some((close) => close !== null)) totalReturn.set(cik, total);
  }
}
const holdersOf = (id: number): number[] => periods.map((_, period) => implied.get(key(period, id))?.holders ?? 0);
/** Filed prices of a security in the quarters in which it is widely held: at least `minimum` filers and a tenth of its widest quarter. */
const runOf = (id: number, minimum: number): (number | null)[] => {
  const holders = holdersOf(id);
  const floor = Math.max(minimum, 0.1 * Math.max(...holders));
  return holders.map((count, period) => (count >= floor ? implied.get(key(period, id))!.price : null));
};
/** Split factors a filed price may stand a little above when cash was paid out after the quarter end. */
const nearClean = [1, 1.5, 2, 3, 4, 5, 10, 20];

// candidates the stored map proposes: by company, and by ticker for rows that never received a company
const proposed = new Map<number, number>();
{
  const normal = (ticker: string) => ticker.toUpperCase().replace(/[./\s-]/g, "");
  const byTicker = new Map<string, number>();
  for (const [cik, ticker] of companies) byTicker.set(normal(ticker), cik);
  for (const row of await select<{ cusip: string; cik: number | null; ticker: string | null }>("SELECT cusip, cik, ticker FROM cusip_map WHERE cik IS NOT NULL OR ticker IS NOT NULL ORDER BY cusip")) {
    const id = cusipIds.get(row.cusip.trim().toUpperCase().padStart(9, "0"));
    if (id === undefined) continue;
    const company = row.cik !== null && companies.has(Number(row.cik)) ? Number(row.cik) : row.ticker ? byTicker.get(normal(row.ticker)) : undefined;
    if (company !== undefined && !proposed.has(id)) proposed.set(id, company);
  }
}

type MatchHow = "price levels" | "map and price levels" | "map and price moves" | "map, company without price history" | "share class of the main security";
interface SecurityMatch {
  id: number;
  company: number;
  how: MatchHow;
  /** Quarters tested, pairs of consecutive tested quarters, and pairs that fit. */
  periods: number;
  pairs: number;
  consistent: number;
  /** Today's shares of the company's main class per filed share, per quarter. */
  factors: number[];
  splits: [number, number][];
  value: number;
}
const matches = new Map<number, SecurityMatch>();
const rejected: { cusip: string; ticker: string; reason: string }[] = [];
const corrected: { cusip: string; mapped: string; matched: string }[] = [];
const securityIds = new Set<number>();
for (const id of implied.keys()) securityIds.add(id % 2 ** 22);
const flat = (factor: number) => new Array<number>(periods.length).fill(factor);

// 1. by price levels alone, and for a short record with the map's proposal
const unmatched: number[] = [];
for (const id of securityIds) {
  const mapped = proposed.get(id);
  const prices = runOf(id, MIN_FILERS);
  const tested = prices.filter((price) => price !== null).length;
  let best: SecurityMatch | null = null;
  if (tested >= MATCH_PERIODS) {
    let anchor = periods.length - 1;
    while (anchor >= 0 && prices[anchor] === null) anchor--;
    for (const [company, stock] of priceOnly) {
      // the latest quarter decides most candidates at once: the filed price is the close times a split factor, or a little above it
      if (!stock[anchor]) continue;
      const level = prices[anchor]! / stock[anchor]!;
      if (cleanLevel(level) === null && !nearClean.some((clean) => level / clean > 1.006 && level / clean <= 1.12)) continue;
      const record = levelRecord(prices, stock);
      if (!record || !levelRecordConfirms(record, MATCH_PERIODS)) continue;
      // between two fits the company the map proposes, then the longer record
      if (!best || company === mapped || (best.company !== mapped && record.periods > best.periods)) {
        best = { id, company, how: "price levels", periods: record.periods, pairs: record.pairs, consistent: record.exact, factors: record.factors, splits: record.splits, value: 0 };
      }
    }
  }
  if (best) {
    if (mapped !== undefined && mapped !== best.company) corrected.push({ cusip: cusips[id], mapped: tickerOf(mapped), matched: tickerOf(best.company) });
    matches.set(id, best);
    continue;
  }
  if (mapped === undefined) { unmatched.push(id); continue; }
  // a short record: the map proposes, the prices must confirm
  const thin = runOf(id, 1);
  const stock = priceOnly.get(mapped);
  if (stock) {
    const record = levelRecord(thin, stock);
    if (record && (record.pairs === 0 ? record.anchorExact : record.near / record.pairs >= 0.6)) {
      matches.set(id, { id, company: mapped, how: "map and price levels", periods: record.periods, pairs: record.pairs, consistent: record.exact, factors: record.factors, splits: record.splits, value: 0 });
      continue;
    }
    unmatched.push(id); // may still be another share class of the proposed company
    continue;
  }
  const total = totalReturn.get(mapped);
  if (!total) { matches.set(id, { id, company: mapped, how: "map, company without price history", periods: 0, pairs: 0, consistent: 0, factors: flat(1), splits: [], value: 0 }); continue; }
  let pairs = 0;
  let agreed = 0;
  for (let period = 1; period < periods.length; period++) {
    if (thin[period - 1] === null || thin[period] === null || !total[period - 1] || !total[period]) continue;
    pairs++;
    if (movesWith(thin[period - 1]!, thin[period]!, total[period - 1]!, total[period]!)) agreed++;
  }
  if (pairs > 0 && agreed / pairs >= 0.6) matches.set(id, { id, company: mapped, how: "map and price moves", periods: pairs + 1, pairs, consistent: agreed, factors: flat(1), splits: [], value: 0 });
  else rejected.push({ cusip: cusips[id], ticker: tickerOf(mapped), reason: pairs ? `mapped, but its price moves with the stock in only ${agreed} of ${pairs} quarters` : "mapped, but too thinly held to test" });
}

// 2. other share classes: a steady price ratio to the company's main security, and prices that move together
interface MainSeries { price: (number | null)[]; factor: number[] }
const mains = new Map<number, MainSeries>();
{
  const widest = new Map<number, number[]>();
  for (const match of matches.values()) {
    if (match.how !== "price levels" && match.how !== "map and price levels") continue;
    const holders = holdersOf(match.id);
    const main = mains.get(match.company) ?? mains.set(match.company, { price: new Array(periods.length).fill(null), factor: flat(1) }).get(match.company)!;
    const most = widest.get(match.company) ?? widest.set(match.company, new Array(periods.length).fill(0)).get(match.company)!;
    for (let period = 0; period < periods.length; period++) {
      if (holders[period] <= most[period]) continue;
      most[period] = holders[period];
      main.price[period] = implied.get(key(period, match.id))!.price;
      main.factor[period] = match.factors[period];
    }
  }
}
for (const id of unmatched) {
  const mapped = proposed.get(id);
  const prices = runOf(id, mapped === undefined ? MIN_FILERS : 1);
  const tested: number[] = [];
  for (let period = 0; period < periods.length; period++) if (prices[period] !== null) tested.push(period);
  let found: SecurityMatch | null = null;
  if (tested.length >= 12) {
    const first = tested[0];
    const last = tested[tested.length - 1];
    for (const [company, main] of mains) {
      // quick look at both ends of the record before the full comparison
      if (main.price[last] === null || main.price[first] === null) continue;
      const ends = prices[last]! / main.price[last]! / (prices[first]! / main.price[first]!);
      if (ends > 1.15 || ends < 1 / 1.15) continue;
      const ratios: number[] = [];
      let pairs = 0;
      let together = 0;
      let before = -1;
      for (const period of tested) {
        if (main.price[period] === null) continue;
        ratios.push(prices[period]! / main.price[period]!);
        if (before >= 0) {
          pairs++;
          if (Math.abs(prices[period]! / prices[before]! / (main.price[period]! / main.price[before]!) - 1) <= 0.025) together++;
        }
        before = period;
      }
      if (ratios.length < 12 || together / pairs < 0.85) continue;
      const perShare = classShares(ratios);
      if (perShare === null) continue;
      found = { id, company, how: "share class of the main security", periods: ratios.length, pairs, consistent: together, factors: main.factor.map((factor) => factor * perShare), splits: [], value: 0 };
      break;
    }
  }
  if (!found && mapped !== undefined) {
    // the map proposed a company and neither the price levels nor a class relation confirm it
    const stock = priceOnly.get(mapped);
    const levels = stock ? tested.filter((period) => stock[period]).map((period) => prices[period]! / stock[period]!) : [];
    const level = middle(levels);
    rejected.push({ cusip: cusips[id], ticker: tickerOf(mapped), reason: level === null ? "mapped, but never held in a quarter the company has a price for" : `mapped, but its price is ${level.toPrecision(3)} times the company's close` });
  }
  if (found) {
    if (mapped !== undefined && mapped !== found.company) corrected.push({ cusip: cusips[id], mapped: tickerOf(mapped), matched: tickerOf(found.company) });
    matches.set(id, found);
  }
}

// --explain <cusip,…> prints what the books and the stock say about a security, quarter by quarter
for (const cusip of (argument("--explain") ?? "").split(",").filter(Boolean)) {
  const id = cusipIds.get(cusip.toUpperCase());
  if (id === undefined) { console.log(`[explain] ${cusip}: not in any filing`); continue; }
  const match = matches.get(id);
  const company = match?.company ?? proposed.get(id);
  const stock = company === undefined ? undefined : priceOnly.get(company);
  console.log(`[explain] ${cusip}: ${match ? `matched ${tickerOf(match.company)} (${match.how}, ${match.consistent}/${match.pairs} pairs over ${match.periods} quarters)` : "not matched"}; map proposes ${proposed.has(id) ? tickerOf(proposed.get(id)!) : "nothing"}`);
  for (let period = 0; period < periods.length; period++) {
    const entry = implied.get(key(period, id));
    if (!entry) continue;
    const close = stock?.[period] ?? null;
    console.log(`   ${periods[period]}  filers ${String(entry.holders).padStart(3)}  price ${entry.price.toPrecision(6).padStart(10)}  stock ${close === null ? "—".padStart(9) : close.toPrecision(6).padStart(9)}  level ${close ? (entry.price / close).toPrecision(5).padStart(8) : "—".padStart(8)}  factor ${match ? match.factors[period] : "—"}`);
  }
}

// --- one book per fund and quarter ---------------------------------------------------------------------------------------------
interface FundQuarter { fund: number; period: string; manager: string | null; book: Map<string, BookPosition>; used: Filing[]; filed: number }
const grouped = new Map<string, Filing[]>();
for (const filing of usable) (grouped.get(`${filing.fund}|${filing.cover.period}`) ?? grouped.set(`${filing.fund}|${filing.cover.period}`, []).get(`${filing.fund}|${filing.cover.period}`)!).push(filing);
const fundQuarters: FundQuarter[] = [];
const leftOutUnit: string[] = [];
const leftOutIncomplete: string[] = [];
let additionsNotRead = 0;
for (const [groupKey, all] of grouped) {
  const [fund, period] = groupKey.split("|");
  const name = all.find((filing) => filing.cover.manager)?.cover.manager ?? "?";
  // filings without a table in the cache contribute nothing; what matters is whether a full report is among them
  const group = all.filter((filing) => !noTable.has(filing));
  const lost = all.filter((filing) => noTable.has(filing));
  const lostReports = lost.filter((filing) => filing.cover.amendment === null || filing.cover.amendment === "RESTATEMENT");
  if (!group.length) { leftOutIncomplete.push(`${groupKey} ${name}: no table in the cache (${lost.map((filing) => `${filing.accession}, ${filing.cover.declaredRows} rows stated`).join("; ")})`); continue; }
  if (group.some((filing) => filing.unit === null)) { leftOutUnit.push(groupKey); continue; }
  const parts: FiledPart[] = group.map((filing) => {
    const positions = new Map<string, BookPosition>();
    const unit = filing.unit!;
    for (let index = 0; index < filing.ids.length; index++) {
      const id = filing.ids[index];
      if (!matches.has(id)) continue;
      positions.set(cusips[id], { shares: filing.shares[index] * unit.shares, value: filing.values[index] * unit.dollars, puts: (filing.puts.get(id) ?? 0) * unit.dollars, calls: (filing.calls.get(id) ?? 0) * unit.dollars, principal: 0 });
    }
    return { accession: filing.accession, amendment: filing.cover.amendment, amendmentNo: filing.cover.amendmentNo, signed: filing.cover.signed, positions };
  });
  const merged = mergeFiledParts(parts);
  const used = merged.used.map((accession) => group.find((filing) => filing.accession === accession)!);
  const part = used.find((filing) => partTable.has(filing));
  if (part) { leftOutIncomplete.push(`${groupKey} ${name}: ${part.accession} holds ${part.rows} of the ${part.cover.declaredRows} rows its cover page states`); continue; }
  // a full report without a table: the rest is a book only if it is about as long (a filer whose report becomes public a year later as an amendment)
  const needed = Math.max(0, ...lostReports.map((filing) => filing.cover.declaredRows ?? 0));
  if (needed > 0 && Math.max(...used.map((filing) => filing.rows)) < 0.9 * needed) { leftOutIncomplete.push(`${groupKey} ${name}: the full report has no table in the cache (${lostReports.map((filing) => `${filing.accession}, ${filing.cover.declaredRows} rows stated`).join("; ")}); only additions are there`); continue; }
  additionsNotRead += lost.length - lostReports.length;
  fundQuarters.push({ fund: Number(fund), period, manager: used.at(-1)?.cover.manager ?? null, book: merged.book, used, filed: all.length });
}

// positions whose own price is off the price of the same security in the other books
let revalued = 0;
let recounted = 0;
let suspect = 0;
const suspects: { fund: number; quarter: string; cusip: string; ticker: string; value: number; ratio: number }[] = [];
for (const entry of fundQuarters) {
  const period = periodIndex.get(entry.period)!;
  const stated = sum(entry.used.map((filing) => filing.shareValue * filing.unit!.dollars));
  for (const [cusip, position] of entry.book) {
    if (!(position.shares > 0 && position.value > 0)) { position.shares = 0; position.value = 0; continue; }
    const id = cusipIds.get(cusip)!;
    const reference = implied.get(key(period, id));
    if (!reference) continue;
    const ratio = position.value / position.shares / reference.price;
    if (ratio > 1 / 3 && ratio < 3) continue;
    if (reference.holders < MIN_FILERS) {
      // nothing to compare with: too few other books hold the security
      suspect++;
      suspects.push({ fund: entry.fund, quarter: entry.period, cusip, ticker: tickerOf(matches.get(id)!.company), value: Math.round(position.value), ratio: Number(ratio.toPrecision(3)) });
      position.shares = 0;
      position.value = 0;
      continue;
    }
    // Shares and value contradict each other at the price of the other books: one of the two is wrong (a stale
    // price: one filer valued Alphabet at its pre-split $2,700 for two years; a slipped unit in a single row; a
    // share count that is something else). Which one cannot be told from the row, so the smaller reading is
    // kept: a wrong row must never add money to a book.
    const atOtherBooks = position.shares * reference.price;
    if (atOtherBooks < position.value) {
      position.value = atOtherBooks;
      revalued++;
    } else {
      position.shares = position.value / reference.price;
      recounted++;
    }
    if (atOtherBooks > 0.05 * stated || position.value > 0.05 * stated) suspects.push({ fund: entry.fund, quarter: entry.period, cusip, ticker: tickerOf(matches.get(id)!.company), value: Math.round(Math.max(atOtherBooks, ratio * atOtherBooks)), ratio: Number(ratio.toPrecision(3)) });
  }
}
for (const entry of fundQuarters) for (const [cusip, position] of entry.book) {
  const match = matches.get(cusipIds.get(cusip)!)!;
  match.value += position.value;
}

// --- quarter files ------------------------------------------------------------------------------------------------------------------
const quarterHashes: FundBooksManifest["quarters"] = [];
for (const period of periods) {
  const index = periodIndex.get(period)!;
  const fundRows: FundBookEntry[] = [];
  const positions: [number, number, number, number][] = [];
  for (const entry of fundQuarters.filter((candidate) => candidate.period === period).sort((a, b) => a.fund - b.fund)) {
    const perCompany = new Map<number, { shares: number; value: number }>();
    let puts = 0;
    let calls = 0;
    for (const [cusip, position] of entry.book) {
      const match = matches.get(cusipIds.get(cusip)!)!;
      puts += position.puts;
      calls += position.calls;
      if (!(position.shares > 0 && position.value > 0)) continue;
      const row = perCompany.get(match.company) ?? perCompany.set(match.company, { shares: 0, value: 0 }).get(match.company)!;
      row.shares += position.shares * match.factors[index];
      row.value += position.value;
    }
    for (const [company, row] of [...perCompany].sort((a, b) => a[0] - b[0])) positions.push([entry.fund, company, Math.round(row.shares), Math.round(row.value)]);
    const dollars = (pick: (filing: Filing) => number) => Math.round(sum(entry.used.map((filing) => pick(filing) * filing.unit!.dollars)));
    fundRows.push({
      fund: entry.fund,
      manager: entry.manager,
      filings: entry.used.map((filing) => filing.accession),
      filed: entry.filed,
      signed: entry.used.map((filing) => filing.cover.signed ?? "").sort().at(-1) || null,
      book: dollars((filing) => filing.shareValue),
      covered: Math.round(sum([...perCompany.values()].map((row) => row.value))),
      positions: perCompany.size,
      securities: sum(entry.used.map((filing) => filing.securities)),
      optionsCovered: { puts: Math.round(puts), calls: Math.round(calls) },
      options: { puts: dollars((filing) => filing.putsTotal), calls: dollars((filing) => filing.callsTotal) },
      principal: dollars((filing) => filing.principal),
      thousands: entry.used.some((filing) => filing.unit!.dollars === 1000),
      totalsAgree: entry.used.every((filing) => totalsAgree.get(filing)),
    });
  }
  const file: FundBooksQuarter = { schemaVersion: FUND_BOOKS_SCHEMA_VERSION, quarter: period, codeVersion, funds: fundRows, positions };
  writeJsonAtomic(path.join(OUT, "quarters", `${period}.json`), file);
  quarterHashes.push({ quarter: period, funds: fundRows.length, positions: positions.length, companies: new Set(positions.map((row) => row[1])).size, book: Math.round(sum(fundRows.map((row) => row.book))), covered: Math.round(sum(fundRows.map((row) => row.covered))), sha256: sha256(JSON.stringify(file)) });
}

// --- manifest ---------------------------------------------------------------------------------------------------------------------
const matchedCompanies = new Set([...matches.values()].map((match) => match.company));
const byHow: Record<string, number> = {};
for (const match of matches.values()) byHow[match.how] = (byHow[match.how] ?? 0) + 1;
const splits = new Map<string, { ticker: string; quarter: string; ratio: number }>();
for (const match of matches.values()) for (const [index, ratio] of match.splits) splits.set(`${match.company}|${index}`, { ticker: tickerOf(match.company), quarter: periods[index], ratio });
const manifest: FundBooksManifest = {
  schemaVersion: FUND_BOOKS_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  codeVersion,
  readerVersion: FILED_TABLE_VERSION,
  cache: CACHE,
  filings: {
    total: filings.length,
    read: parsed,
    reused,
    withoutCover,
    originals: filings.filter((filing) => filing.cover.amendment === null).length,
    restatements: filings.filter((filing) => filing.cover.amendment === "RESTATEMENT").length,
    additions: filings.filter((filing) => filing.cover.amendment === "NEW HOLDINGS").length,
    unknownAmendments: filings.filter((filing) => filing.cover.amendment === "UNKNOWN").map((filing) => `${filing.fund}/${filing.accession}`),
    withoutPeriod: filings.filter((filing) => filing.cover.period === null).map((filing) => `${filing.fund}/${filing.accession}`),
    totals,
  },
  units: { counts: unitCounts, unknown: unitUnknown },
  fundQuartersLeftOut: { unreadableUnit: leftOutUnit, incompleteTable: leftOutIncomplete.sort() },
  additionsNotRead,
  positions: { valueLowered: revalued, sharesLowered: recounted, leftOut: suspect, largest: suspects.sort((a, b) => b.value - a.value).slice(0, 40) },
  securities: {
    seen: cusips.length,
    proposedByMap: proposed.size,
    matched: matches.size,
    matchedBy: byHow,
    companies: matchedCompanies.size,
    companiesWithout: [...companies].filter(([cik]) => !matchedCompanies.has(cik)).map(([, ticker]) => ticker).sort(),
    list: [...matches.values()].sort((a, b) => b.value - a.value).map((match) => ({ cusip: cusips[match.id], ticker: tickerOf(match.company), how: match.how, periods: match.periods, pairs: match.pairs, consistent: match.consistent, factor: match.factors[periods.length - 1], value: Math.round(match.value) })),
    mapCorrected: corrected,
    rejected,
  },
  splits: [...splits.values()].sort((a, b) => a.quarter.localeCompare(b.quarter) || a.ticker.localeCompare(b.ticker)),
  quarters: quarterHashes,
};
writeJsonAtomic(path.join(OUT, "manifest.json"), manifest);
const full = quarterHashes.reduce((bestRow, row) => (row.funds > bestRow.funds ? row : bestRow), quarterHashes[0]);
console.log(
  `[fund-books] ${quarterHashes.length} quarters ${periods[0]}..${periods.at(-1)} · ${fundQuarters.length} fund-quarters (left out: ${leftOutUnit.length} for an unreadable unit, ${leftOutIncomplete.length} without a whole table in the cache; ${additionsNotRead} later additions without a table) · cover totals ${JSON.stringify(totals)} · ` +
    `securities matched ${matches.size} ${JSON.stringify(byHow)} for ${matchedCompanies.size} of ${companies.size} companies, ${rejected.length} map rows rejected, ${corrected.length} corrected, ${splits.size} splits · positions with a price off: value lowered ${revalued}, shares lowered ${recounted}, left out ${suspect} · ` +
    `${full.quarter}: ${full.funds} funds, ${full.companies} companies, filed $${(full.book / 1e12).toFixed(2)}tn, covered $${(full.covered / 1e12).toFixed(2)}tn · code ${codeVersion} · ${Math.round((Date.now() - started) / 1000)} s · ${OUT}`,
);
process.exit(0);
