/**
 * Builds public/reports/desk-snapshot.json, the one file behind the desk view's market map, screener and today
 * page (contracts/desk-snapshot.ts). Read-only on every input:
 *   - local MySQL: companies (S&P 500 classification plus the research companies), stored daily closes of the
 *     last ~14 months (Stooq history, Schwab bars after the last Stooq date), stored 8-K earnings events;
 *   - the Schwab archives on D: — instruments (fundamentals) and the latest quotes folder of the S&P 500 root and
 *     of the research root (never the token file);
 *   - public/reports/schwab-features.json (option features of the research companies), when present.
 * The D: archives are required: when a root is missing the build stops and the previous snapshot stays in place.
 *
 *   npx tsx scripts/build-desk-snapshot.mts [--dry-run]
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../api/queries/connection";
import { buildDeskSnapshot, deskOptions, normalizeTicker, schwabFundamentals, spliceCloses, type DeskFundamentals, type StoredCloseRow } from "../worker/lib/desk-snapshot";
import { writeJsonAtomic } from "../worker/lib/json-file";
import type { DeskOptions } from "../contracts/desk-snapshot";

const SCHWAB_ROOTS = ["D:/research/alpha-engine/schwab-sp500", "D:/research/alpha-engine/schwab"];
const OUT = path.resolve("public/reports/desk-snapshot.json");
const DIST_OUT = path.resolve("dist/public/reports/desk-snapshot.json");
const FEATURES = path.resolve("public/reports/schwab-features.json");
const RESEARCH = path.resolve("worker/research-universe-50.json");
const dryRun = process.argv.includes("--dry-run");

const here = fileURLToPath(import.meta.url);
const codeVersion = createHash("sha256")
  .update([here, path.resolve("worker/lib/desk-snapshot.ts"), path.resolve("contracts/desk-snapshot.ts")].map((file) => readFileSync(file, "utf8")).join("\n"))
  .digest("hex")
  .slice(0, 12);

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

// --- Schwab archives (D:) -------------------------------------------------------------------------------------
const fundamentals = new Map<string, DeskFundamentals>();
const quoteDates: string[] = [];
let instrumentFiles = 0;
let quoteFiles = 0;
for (const root of SCHWAB_ROOTS) {
  const instrumentsDir = path.join(root, "instruments");
  const quotesDir = path.join(root, "quotes");
  if (!existsSync(instrumentsDir) || !existsSync(quotesDir)) {
    throw new Error(`Schwab archive not reachable: ${root} (is the D: drive mounted?) — the previous snapshot is kept`);
  }
  const latest = readdirSync(quotesDir).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && readdirSync(path.join(quotesDir, name)).some((file) => file.endsWith(".json"))).sort().at(-1);
  if (latest) quoteDates.push(latest);
  const quotes = new Map<string, unknown>();
  if (latest) {
    for (const file of readdirSync(path.join(quotesDir, latest)).filter((name) => name.endsWith(".json"))) {
      const body = readJson(path.join(quotesDir, latest, file));
      const symbol = Object.keys(body)[0];
      if (symbol) quotes.set(normalizeTicker(symbol), body);
    }
  }
  for (const file of readdirSync(instrumentsDir).filter((name) => name.endsWith(".json"))) {
    const instrument = readJson(path.join(instrumentsDir, file));
    const symbol = instrument?.instruments?.[0]?.symbol ?? file.replace(/\.json$/, "");
    const key = normalizeTicker(symbol);
    fundamentals.set(key, schwabFundamentals(instrument, quotes.get(key) ?? null));
    instrumentFiles++;
    if (quotes.has(key)) quoteFiles++;
  }
}

// --- option features (research companies) -----------------------------------------------------------------------
const options = new Map<string, DeskOptions>();
let optionsGeneratedAt: string | null = null;
if (existsSync(FEATURES)) {
  const features = readJson(FEATURES);
  optionsGeneratedAt = typeof features.generatedAt === "string" ? features.generatedAt : null;
  for (const feature of features.tickers ?? []) {
    const value = deskOptions(feature);
    if (value) options.set(normalizeTicker(String(feature.ticker)), value);
  }
}

// --- database (read-only) ----------------------------------------------------------------------------------------
const client = getDb().$client.promise();
const select = async <T,>(sql: string, params: unknown[] = []): Promise<T[]> => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("The desk snapshot reads only");
  const [rows] = await client.query(sql, params);
  return rows as T[];
};

const research = new Set<number>((readJson(RESEARCH) as { cik: number }[]).map((row) => Number(row.cik)));
// The cached S&P 500 constituents table: display names ("Bank of America" rather than "BANK OF AMERICA CORP /DE/")
// and the GICS sector of members whose registry row has none.
const constituentRows = await select<{ payload: string }>("SELECT payload FROM external_cache WHERE `key` = 'idx-sp500'");
const constituents = new Map<number, { name: string; sector: string | null; industry: string | null }>();
try {
  for (const row of JSON.parse(constituentRows[0]?.payload ?? "[]") as { cik: number; name: string; sector?: string; industry?: string }[]) {
    if (!row?.cik || !row.name || constituents.has(Number(row.cik))) continue;
    constituents.set(Number(row.cik), { name: row.name.replace(/\s*\(Class [A-Z]\)$/, "").replace(/^(.+) \(The\)$/, "The $1"), sector: row.sector || null, industry: row.industry || null });
  }
} catch {
  // an unreadable cache only costs the nicer names and the fallback sectors
}
const companyRows = await select<{ cik: number; ticker: string; name: string | null; sector: string | null; industry: string | null }>(
  "SELECT cik, ticker, name, sector, industry FROM companies WHERE sector IS NOT NULL OR cik IN (?)",
  [[...research, ...constituents.keys()]],
);
const since = new Date(Date.now() - 430 * 86_400_000).toISOString().slice(0, 10);
const priceRows = await select<{ cik: number; ticker: string; date: string; close: number | null; source: string }>(
  "SELECT cik, ticker, DATE_FORMAT(date, '%Y-%m-%d') AS date, close, source FROM prices WHERE date >= ? AND source IN ('stooq', 'schwab')",
  [since],
);
const eventRows = await select<{ cik: number; date: string }>("SELECT cik, DATE_FORMAT(eventDate, '%Y-%m-%d') AS date FROM events");
const registryName = (name: string | null, ticker: string) => (name ?? ticker).replace(/\s*\/[A-Z]{2,3}\/?\s*$/, "").replace(/\s*\/NEW\/?\s*$/i, "").trim() || ticker;

const rowsByCik = new Map<number, StoredCloseRow[]>();
const benchmarkRows: StoredCloseRow[] = [];
// The registry ticker of some companies is a preferred share, warrant or second class (MER-PK for Bank of America);
// the ticker the latest price row was fetched under is the traded common share, so the desk shows that one.
const fetchedTicker = new Map<number, { date: string; ticker: string }>();
for (const row of priceRows) {
  const value = { date: row.date, close: row.close === null ? null : Number(row.close), source: row.source };
  if (Number(row.cik) === 0) {
    if (row.ticker === "SPY") benchmarkRows.push(value);
    continue;
  }
  const list = rowsByCik.get(Number(row.cik));
  if (list) list.push(value);
  else rowsByCik.set(Number(row.cik), [value]);
  const seen = fetchedTicker.get(Number(row.cik));
  if (row.source === "stooq" && (!seen || row.date > seen.date)) fetchedTicker.set(Number(row.cik), { date: row.date, ticker: row.ticker });
}
const closes = new Map([...rowsByCik].map(([cik, rows]) => [cik, spliceCloses(rows)] as const));
const events = new Map<number, string[]>();
for (const row of eventRows) events.set(Number(row.cik), [...(events.get(Number(row.cik)) ?? []), row.date]);

const snapshot = buildDeskSnapshot({
  generatedAt: new Date().toISOString(),
  codeVersion,
  companies: companyRows.map((row) => ({
    cik: Number(row.cik),
    ticker: fetchedTicker.get(Number(row.cik))?.ticker ?? row.ticker,
    registryTicker: row.ticker,
    name: constituents.get(Number(row.cik))?.name ?? registryName(row.name, row.ticker),
    sector: row.sector ?? constituents.get(Number(row.cik))?.sector ?? null,
    industry: row.industry ?? constituents.get(Number(row.cik))?.industry ?? null,
    research: research.has(Number(row.cik)),
  })),
  closes,
  benchmark: benchmarkRows.length ? { ticker: "SPY", closes: spliceCloses(benchmarkRows) } : null,
  fundamentals,
  options,
  events,
  inputs: {
    priceRows: priceRows.length,
    schwabQuoteDates: quoteDates,
    fundamentals: instrumentFiles,
    quotes: quoteFiles,
    optionTickers: options.size,
    optionsGeneratedAt,
    earningsEvents: eventRows.length,
  },
});

const covered = snapshot.companies.filter((company) => company.marketCap !== null).length;
const summary = `[desk-snapshot] session ${snapshot.session} (previous ${snapshot.previousSession}) · ${snapshot.companies.length} companies, ${covered} with market cap, ${snapshot.companies.filter((company) => company.options).length} with option features · breadth ${snapshot.breadth.advancers} up / ${snapshot.breadth.decliners} down · ${snapshot.inputs.companiesWithoutPrices.length} without prices · code ${codeVersion}`;
if (dryRun) {
  console.log(`${summary} · dry run, nothing written`);
} else {
  writeJsonAtomic(OUT, snapshot);
  if (existsSync(path.dirname(path.dirname(DIST_OUT)))) writeJsonAtomic(DIST_OUT, snapshot);
  console.log(`${summary} · ${OUT}`);
}
process.exit(0);
