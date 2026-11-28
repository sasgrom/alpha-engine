/**
 * Builds the money map's trading layer and the company page's trading strip (contracts/fund-flows.ts, FlowTradingFile
 * and FlowTradingCompany) into worker/.runs/desk-flows/trading.json and trading/<cik>.json. Read-only on every input:
 *   - local MySQL `prices`: daily Schwab bars (source 'schwab', else 'schwab-hist') of the money map's companies and
 *     their peers, about 15 months;
 *   - worker/.runs/desk-flows/overview.json: the map's companies and sectors;
 *   - the newest lab volume-flows build D:/research/alpha-engine/flows/daily/<stamp>/peers.json (measured peers,
 *     confirmed by a shared industry ETF; lab src/research/flows/daily_flows.py) and its panel's entities for the CIKs;
 *   - ETF share counts: the daily quote archive D:/research/alpha-engine/schwab-sp500/quotes/<date>/<FUND>.json (SPY
 *     and the sector funds since 2026-11-11; capture time = file time) and the hourly
 *     D:/research/alpha-engine/etf-shares/shares.jsonl (51 funds since 2026-11-28).
 * A missing input stops the build and the previous files stay.
 *
 *   npx tsx scripts/build-flow-trading.mts [--weeks 53]
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getDb } from "../api/queries/connection";
import type { FlowEtfFlow, FlowTradingCompany, FlowTradingFile, FlowTradingSector, FundFlowsOverview } from "../contracts/fund-flows";
import { ETF_FUNDS } from "../worker/lib/etf-flows";
import { etfWeekFlows, groupVsNormal, normalBefore, weeksOf, weekVolume, type ShareCapture } from "../worker/lib/flow-trading";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const WEEKS = Number(arg("--weeks") ?? 53);
const OUT = path.resolve("worker/.runs/desk-flows");
const FLOWS_ROOT = "D:/research/alpha-engine/flows/daily";
const QUOTES = "D:/research/alpha-engine/schwab-sp500/quotes";
const SHARES = "D:/research/alpha-engine/etf-shares/shares.jsonl";
const SECTOR_FUND: Record<string, string> = {
  "Information Technology": "XLK", Financials: "XLF", "Health Care": "XLV", "Communication Services": "XLC", Industrials: "XLI",
  "Consumer Discretionary": "XLY", "Consumer Staples": "XLP", Energy: "XLE", Utilities: "XLU", "Real Estate": "XLRE", Materials: "XLB",
};
const log = (line: string) => console.log(`[flow-trading] ${line}`);
const readJson = <T,>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

const overviewFile = path.join(OUT, "overview.json");
if (!existsSync(overviewFile)) throw new Error("worker/.runs/desk-flows/overview.json is missing; build the fund flows first");
const overview = readJson<FundFlowsOverview>(overviewFile);
if (!existsSync(FLOWS_ROOT)) throw new Error(`${FLOWS_ROOT} not reachable (is the D: drive mounted?)`);
const flowsStamp = readdirSync(FLOWS_ROOT).filter((name) => /^\d{8}T\d{6}Z$/.test(name) && existsSync(path.join(FLOWS_ROOT, name, "peers.json"))).sort().at(-1);
if (!flowsStamp) throw new Error(`no lab volume-flows build with peers.json under ${FLOWS_ROOT}`);
const peersFile = path.join(FLOWS_ROOT, flowsStamp, "peers.json");
const flowsManifest = readJson<{ inputs: Record<string, string> }>(path.join(FLOWS_ROOT, flowsStamp, "manifest.json"));
const entitiesFile = Object.keys(flowsManifest.inputs).find((file) => file.endsWith("entities.json"));
if (!entitiesFile || !existsSync(entitiesFile)) throw new Error("the peers build names no readable panel entities.json");
const tickerCik = new Map<string, number>();
for (const entity of readJson<{ ticker: string; cik: number | null }[]>(entitiesFile)) if (entity.cik && entity.ticker && !tickerCik.has(entity.ticker)) tickerCik.set(entity.ticker, Number(entity.cik));
type PeerEntry = { basis: "confirmed" | "measured-only"; funds: string[]; confirmed: [string, number][]; measured: [string, number][] };
const peersByQuarter = readJson<Record<string, Record<string, PeerEntry>>>(peersFile);
const peerQuarter = Object.keys(peersByQuarter).sort().at(-1)!;
const peers = peersByQuarter[peerQuarter];
log(`peers ${flowsStamp} quarter ${peerQuarter}: ${Object.keys(peers).length} companies`);

// --- daily dollar volume from the stored Schwab bars --------------------------------------------------------------
const companies = overview.companies.map((company) => ({ cik: company.cik, ticker: company.ticker, sector: company.sector }));
const peerCiks = new Set<number>();
for (const company of companies) {
  const entry = peers[company.ticker];
  const list = entry ? (entry.basis === "confirmed" ? entry.confirmed : entry.measured) : [];
  for (const [ticker] of list) { const cik = tickerCik.get(ticker); if (cik) peerCiks.add(cik); }
}
const wanted = [...new Set([...companies.map((company) => company.cik), ...peerCiks])];
const client = getDb().$client.promise();
const since = new Date(Date.now() - 470 * 86_400_000).toISOString().slice(0, 10);
const [rows] = await client.query(
  "SELECT cik, DATE_FORMAT(date, '%Y-%m-%d') AS date, close, volume, source FROM prices WHERE date >= ? AND source IN ('schwab', 'schwab-hist') AND cik IN (?)",
  [since, wanted],
);
const bars = new Map<number, Map<string, { usd: number; source: string }>>();
for (const row of rows as { cik: number; date: string; close: number | null; volume: number | null; source: string }[]) {
  if (row.close === null || row.volume === null || Number(row.volume) <= 0) continue;
  const byDate = bars.get(Number(row.cik)) ?? new Map();
  const previous = byDate.get(row.date);
  // the live Schwab bar wins over the backfilled history of the same day (they agree where both exist)
  if (!previous || (previous.source !== "schwab" && row.source === "schwab")) byDate.set(row.date, { usd: Number(row.close) * Number(row.volume), source: row.source });
  bars.set(Number(row.cik), byDate);
}
await client.end?.();
// sessions: days on which most of the map's companies have a bar
const perDate = new Map<string, number>();
for (const company of companies) for (const date of bars.get(company.cik)?.keys() ?? []) perDate.set(date, (perDate.get(date) ?? 0) + 1);
const sessions = [...perDate].filter(([, n]) => n >= companies.length * 0.6).map(([date]) => date).sort();
if (sessions.length < 60) throw new Error(`only ${sessions.length} sessions with most companies priced; the prices table looks incomplete`);
const allWeeks = weeksOf(sessions);
const weeks = allWeeks.slice(-WEEKS).filter((week) => week.index[0] >= 10);
const dailyOf = (cik: number) => sessions.map((date) => bars.get(cik)?.get(date)?.usd ?? null);
const daily = new Map(wanted.map((cik) => [cik, dailyOf(cik)]));
log(`${rows.length.toLocaleString("en-US")} bars, ${sessions.length} sessions ${sessions[0]}..${sessions.at(-1)}, ${weeks.length} weeks`);

// --- companies, sectors, market -----------------------------------------------------------------------------------
const companyRows: FlowTradingFile["companies"] = companies.map((company) => {
  const series = daily.get(company.cik)!;
  const per = weeks.map((week) => weekVolume(series, week.index));
  return [company.cik, per.map((entry) => round(entry.dollars)), per.map((entry) => round(entry.vsNormal, 3))];
});
const marketDollars = weeks.map((_, w) => companyRows.reduce((sum, row) => sum + (row[1][w] ?? 0), 0));
const marketCount = weeks.map((_, w) => companyRows.filter((row) => row[1][w] !== null).length);
const market = {
  dollars: marketDollars.map((value) => round(value)),
  vsNormal: weeks.map((week) => round(groupVsNormal(companies.map((company) => ({ daily: daily.get(company.cik)! })), week.index), 3)),
  companies: marketCount,
};
const sectors: FlowTradingSector[] = overview.sectorNames.map((sector) => {
  const members = companies.filter((company) => company.sector === sector);
  const dollars = weeks.map((_, w) => members.reduce((sum, company) => sum + (companyRows.find((row) => row[0] === company.cik)![1][w] ?? 0), 0));
  return {
    sector,
    fund: SECTOR_FUND[sector] ?? "",
    dollars: dollars.map((value) => round(value)),
    share: dollars.map((value, w) => (marketDollars[w] > 0 ? round(value / marketDollars[w], 5) : null)),
    vsNormal: weeks.map((week) => round(groupVsNormal(members.map((company) => ({ daily: daily.get(company.cik)! })), week.index), 3)),
  };
});

// --- ETF money flows from share counts ----------------------------------------------------------------------------
const captures = new Map<string, ShareCapture[]>();
const add = (fund: string, capture: ShareCapture) => captures.set(fund, [...(captures.get(fund) ?? []), capture]);
if (existsSync(QUOTES)) {
  for (const day of readdirSync(QUOTES).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort()) {
    for (const fund of ETF_FUNDS) {
      const file = path.join(QUOTES, day, `${fund.ticker}.json`);
      if (!existsSync(file)) continue;
      const entry = readJson<Record<string, any>>(file)[fund.ticker];
      const shares = entry?.fundamental?.sharesOutstanding;
      if (typeof shares !== "number") continue;
      add(fund.ticker, { capturedAt: statSync(file).mtime.toISOString(), shares, price: entry?.regular?.regularMarketLastPrice ?? entry?.quote?.closePrice ?? null });
    }
  }
}
if (existsSync(SHARES)) {
  for (const line of readFileSync(SHARES, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { ticker: string; capturedAt: string; sharesOutstanding: number | null; regularPrice?: number | null; closePrice: number | null };
    if (row.sharesOutstanding === null) continue;
    add(row.ticker, { capturedAt: row.capturedAt, shares: row.sharesOutstanding, price: row.regularPrice ?? row.closePrice ?? null });
  }
}
const etf: FlowEtfFlow[] = ETF_FUNDS.map((fund) => {
  const flow = etfWeekFlows(captures.get(fund.ticker) ?? [], sessions, weeks);
  return { fund: fund.ticker, group: fund.group, covers: fund.covers, dollars: flow.dollars.map((value) => round(value)), from: flow.from, to: flow.to };
});

const builtAt = new Date().toISOString();
const file: FlowTradingFile = {
  schemaVersion: 1,
  builtAt,
  latestSession: sessions.at(-1)!,
  weeks: weeks.map((week) => ({ end: week.end, sessions: week.index.length })),
  companies: companyRows,
  market,
  sectors,
  etf,
  source: `Daily Schwab bars in the local prices table (${sessions[0]}..${sessions.at(-1)}); peers ${flowsStamp} (${peerQuarter}, sha256 ${sha(peersFile).slice(0, 12)}); ETF share counts from the daily quote archive and etf-shares.jsonl.`,
};
mkdirSync(path.join(OUT, "trading"), { recursive: true });
writeJsonAtomic(path.join(OUT, "trading.json"), file);

// --- one file per company: the last 130 sessions and its peers ------------------------------------------------------
const latestWeek = weeks.length - 1;
const latestVs = (cik: number) => {
  const series = daily.get(cik);
  return series ? round(weekVolume(series, weeks[latestWeek].index).vsNormal, 3) : null;
};
let written = 0;
for (const company of companies) {
  const series = daily.get(company.cik)!;
  const start = Math.max(0, sessions.length - 130);
  const days: FlowTradingCompany["days"] = [];
  for (let i = start; i < sessions.length; i++) {
    const usd = series[i];
    if (usd === null) continue;
    const normal = normalBefore(series, i);
    days.push([sessions[i], Math.round(usd), normal ? round(usd / normal, 3) : null]);
  }
  const entry = peers[company.ticker];
  let peerBlock: FlowTradingCompany["peers"] = null;
  if (entry) {
    const list = (entry.basis === "confirmed" ? entry.confirmed : entry.measured)
      .map(([ticker, corr]) => ({ cik: tickerCik.get(ticker) ?? 0, ticker, corr, vsNormal: tickerCik.get(ticker) ? latestVs(tickerCik.get(ticker)!) : null }))
      .filter((peer) => peer.cik > 0);
    const members = list.map((peer) => daily.get(peer.cik)).filter((series): series is (number | null)[] => Boolean(series)).map((series) => ({ daily: series }));
    peerBlock = { quarter: peerQuarter, basis: entry.basis, funds: entry.funds, list, vsNormal: members.length ? round(groupVsNormal(members, weeks[latestWeek].index), 3) : null };
  }
  const out: FlowTradingCompany = { schemaVersion: 1, builtAt, cik: company.cik, ticker: company.ticker, sector: company.sector ?? null, days, peers: peerBlock };
  writeJsonAtomic(path.join(OUT, "trading", `${company.cik}.json`), out);
  written++;
}
const etfWithData = etf.filter((entry) => entry.dollars.some((value) => value !== null && value !== 0)).length;
log(`written trading.json (${companies.length} companies, ${weeks.length} weeks to ${weeks.at(-1)?.end}, ${etfWithData} funds with flows) and ${written} company files`);
process.exit(0);

function round(value: number | null, digits = 0): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
