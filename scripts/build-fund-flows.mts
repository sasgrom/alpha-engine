/**
 * Builds the fund-flow files of the desk (contracts/fund-flows.ts) from the fund books as filed
 * (scripts/build-fund-books.mts, contracts/fund-books.ts): for every pair of consecutive complete quarters the
 * split-corrected flows of the funds that filed both, the estimated sector rotation, what followed the money, and
 * a profile per fund and per company.
 *
 * Reads the books under --books (default D:/research/alpha-engine/fund-books) and, read-only, the database
 * (companies, prices, macro_points; fund names and tiers from fund_holdings). Writes
 * worker/.runs/desk-flows/overview.json, fund/<cik>.json and company/<cik>.json atomically.
 *
 *   npx tsx scripts/build-fund-books.mts
 *   npx tsx scripts/build-fund-flows.mts [--dry-run] [--out <folder>] [--books <folder>]
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../api/queries/connection";
import { comparableFunds, filingDeadline } from "../api/services/institutional-guard";
import { FUND_BOOKS_SCHEMA_VERSION, type FundBookEntry, type FundBooksManifest, type FundBooksQuarter } from "../contracts/fund-books";
import { FUND_NOTES } from "../contracts/fund-notes";
import {
  FUND_FLOWS_SCHEMA_VERSION,
  type CompanyFundRow,
  type FlowCompanyRow,
  type FlowOutcome,
  type FlowQuarter,
  type FundFlowsCompany,
  type FundFlowsFund,
  type FundFlowsOverview,
  type FundMove,
  type FundSeriesPoint,
} from "../contracts/fund-flows";
import {
  addLinks,
  bookReturn,
  bookShape,
  flowOutcome,
  fundCategory,
  fundStory,
  impliedPrices,
  linksFromTotals,
  median,
  overlap,
  positionFlows,
  reportingChange,
  rotationLinks,
  shareBasisChange,
  styleTags,
  type Holding,
  type PositionFlow,
} from "../worker/lib/fund-flows";
import { writeJsonAtomic } from "../worker/lib/json-file";

const outArg = process.argv.indexOf("--out");
const OUT = path.resolve(outArg > 0 ? process.argv[outArg + 1] : "worker/.runs/desk-flows");
const booksArg = process.argv.indexOf("--books");
const BOOKS = path.resolve(booksArg > 0 ? process.argv[booksArg + 1] : "D:/research/alpha-engine/fund-books");
const SNAPSHOT = path.resolve("public/reports/desk-snapshot.json");
const dryRun = process.argv.includes("--dry-run");
if (!existsSync(path.join(BOOKS, "manifest.json"))) throw new Error(`No fund books at ${BOOKS} (is the D: drive connected, and has scripts/build-fund-books.mts run?). Nothing was changed.`);
const booksManifest = JSON.parse(readFileSync(path.join(BOOKS, "manifest.json"), "utf8")) as FundBooksManifest;
if (booksManifest.schemaVersion !== FUND_BOOKS_SCHEMA_VERSION) throw new Error(`The fund books at ${BOOKS} are schema ${booksManifest.schemaVersion}; this build reads schema ${FUND_BOOKS_SCHEMA_VERSION}. Run scripts/build-fund-books.mts.`);
const here = fileURLToPath(import.meta.url);
const codeVersion = createHash("sha256")
  .update([here, path.resolve("worker/lib/fund-flows.ts"), path.resolve("contracts/fund-flows.ts"), path.resolve("contracts/fund-notes.ts")].map((file) => readFileSync(file, "utf8")).join("\n"))
  .digest("hex")
  .slice(0, 12);

const client = getDb().$client.promise();
const select = async <T,>(sql: string, params: unknown[] = []): Promise<T[]> => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("The fund-flow build reads only");
  return (await client.query(sql, params))[0] as T[];
};
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const cleanName = (raw: string) =>
  raw.replace(/\s*\(CIK[\s\d]*\)?/gi, "").replace(/\s*\([A-Z0-9.,\-/\s]*\)/g, "").replace(/\s*\([A-Z0-9.,\-/\s]*$/, "").replace(/\s*\/[A-Z]{2,3}\/?\s*$/, "").replace(/\\+$/, "").replace(/\s+/g, " ").trim();

// --- quarters ---------------------------------------------------------------------------------------------------
const coverage = booksManifest.quarters.map((row) => ({ q: row.quarter, funds: row.funds })).sort((a, b) => a.q.localeCompare(b.q));
const today = new Date().toISOString().slice(0, 10);
const typical = median(coverage.map((row) => Number(row.funds))) ?? 0;
const quarters = coverage.filter((row) => Number(row.funds) >= typical * 0.6 && filingDeadline(row.q) < today).map((row) => row.q);
if (quarters.length < 2) throw new Error("Fewer than two complete 13F quarters are stored");
const open = coverage.filter((row) => row.q > quarters.at(-1)!).at(-1) ?? null;

// --- companies, prices, inflation ---------------------------------------------------------------------------------
const directory = new Map<number, { ticker: string; name: string; sector: string }>();
if (existsSync(SNAPSHOT)) {
  for (const company of JSON.parse(readFileSync(SNAPSHOT, "utf8")).companies ?? []) directory.set(Number(company.cik), { ticker: company.ticker, name: company.name, sector: company.sector });
}
for (const row of await select<{ cik: number; ticker: string; name: string | null; sector: string | null }>("SELECT cik, ticker, name, sector FROM companies")) {
  if (!directory.has(Number(row.cik))) directory.set(Number(row.cik), { ticker: row.ticker, name: cleanName(row.name ?? row.ticker), sector: row.sector ?? "Other" });
}
const sectorOf = (company: number) => directory.get(company)?.sector ?? "Other";
const tickerOf = (company: number) => directory.get(company)?.ticker ?? `CIK ${company}`;

const priceRows = await select<{ cik: number; ticker: string; d: string; close: number }>(
  "SELECT cik, ticker, DATE_FORMAT(date,'%Y-%m-%d') d, close FROM prices WHERE source='stooq' AND date >= DATE_SUB(?, INTERVAL 12 DAY) AND close IS NOT NULL ORDER BY date",
  [quarters[0]],
);
const closes = new Map<number, { d: string; close: number }[]>();
for (const row of priceRows) {
  const cik = Number(row.cik);
  if (cik === 0 && row.ticker !== "SPY") continue;
  const list = closes.get(cik);
  if (list) list.push({ d: row.d, close: Number(row.close) });
  else closes.set(cik, [{ d: row.d, close: Number(row.close) }]);
}
const latestPriceDate = priceRows.length ? priceRows[priceRows.length - 1].d : null;
/** Total-return close on or before a date, at most ten days old. */
function closeAt(cik: number, date: string): number | null {
  const series = closes.get(cik);
  if (!series) return null;
  let low = 0;
  let high = series.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (series[middle].d <= date) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  if (found < 0) return null;
  const age = (Date.parse(date) - Date.parse(series[found].d)) / 86_400_000;
  return age <= 10 ? series[found].close : null;
}
const ret = (cik: number, from: string, to: string | null): number | null => {
  if (!to || to <= from) return null;
  const a = closeAt(cik, from);
  const b = closeAt(cik, to);
  return a && b ? b / a - 1 : null;
};

const cpiRows = await select<{ d: string; value: number | null; realtimeStart: string | null }>("SELECT DATE_FORMAT(date,'%Y-%m-%d') d, value, DATE_FORMAT(realtimeStart,'%Y-%m-%d') realtimeStart FROM macro_points WHERE seriesId='CPIAUCSL' AND date >= '2020-01-01' ORDER BY date, realtimeStart");
const cpi = new Map<string, number>();
for (const row of cpiRows) if (row.value !== null) cpi.set(row.d.slice(0, 7), Number(row.value)); // the latest vintage of a month wins
const cpiAt = (quarter: string): number | null => {
  const months = [...cpi.keys()].filter((month) => month <= quarter.slice(0, 7)).sort();
  return months.length ? cpi.get(months.at(-1)!)! : null;
};

// --- funds ---------------------------------------------------------------------------------------------------------
const fundNames = new Map<number, { name: string; tier: string | null }>();
for (const row of await select<{ fundCik: number; name: string; tier: string | null }>("SELECT fundCik, MAX(fundName) name, MAX(tier) tier FROM fund_holdings WHERE quarterDate >= ? GROUP BY fundCik", [quarters[0]])) {
  fundNames.set(Number(row.fundCik), { name: FUND_NOTES[Number(row.fundCik)]?.display ?? cleanName(row.name), tier: row.tier });
}
/** What each fund filed in all for a quarter, keyed `fund|quarter`. */
const filedBooks = new Map<string, FundBookEntry>();
const books = new Map<string, number>();
const loadQuarter = (quarter: string): Holding[] => {
  const file = JSON.parse(readFileSync(path.join(BOOKS, "quarters", `${quarter}.json`), "utf8")) as FundBooksQuarter;
  const listed = booksManifest.quarters.find((row) => row.quarter === quarter);
  if (file.codeVersion !== booksManifest.codeVersion || file.positions.length !== listed?.positions) throw new Error(`The fund book of ${quarter} does not match its manifest; run scripts/build-fund-books.mts again.`);
  for (const entry of file.funds) {
    filedBooks.set(`${entry.fund}|${quarter}`, entry);
    books.set(`${entry.fund}|${quarter}`, entry.book);
    if (!fundNames.has(entry.fund)) fundNames.set(entry.fund, { name: FUND_NOTES[entry.fund]?.display ?? cleanName(entry.manager ?? `CIK ${entry.fund}`), tier: null });
  }
  return file.positions.map(([fund, company, shares, value]) => ({ fund, company, shares, value }));
};

// --- pass over the quarters ---------------------------------------------------------------------------------------------
interface FundQuarterState { tracked: number; positions: number; bought: number | null; sold: number | null; flows: PositionFlow[]; book: Holding[] }
const fundQuarter = new Map<number, Map<string, FundQuarterState>>();
const heldSince = new Map<number, Map<number, string>>();
const flowQuarters: FlowQuarter[] = [];
const flowsByQuarter = new Map<string, PositionFlow[]>();
const flowsByCompany = new Map<string, Map<number, PositionFlow[]>>();
const companyQuarter = new Map<number, Map<string, { holders: number; held: number }>>();
const allFundsReturn = new Map<string, number | null>();
let suspectPositions = 0;
const holdings = quarters.map(loadQuarter);
const holdingsByFund = holdings.map((rows) => {
  const byFund = new Map<number, Holding[]>();
  for (const row of rows) {
    const list = byFund.get(row.fund);
    if (list) list.push(row);
    else byFund.set(row.fund, [row]);
  }
  return byFund;
});
const ratioText = (ratio: number) => `×${ratio >= 1 ? Number(ratio.toFixed(3)) : Math.abs(1 / ratio - Math.round(1 / ratio)) < 0.01 ? `1/${Math.round(1 / ratio)}` : ratio.toFixed(3)}`;

interface PairAnalysis {
  comparable: ReturnType<typeof comparableFunds>;
  /** Funds whose flows are counted in this pair of quarters. */
  stable: Set<number>;
  reportingChanges: number[];
  factors: Map<number, number>;
  splits: string[];
  listed: string[];
  flows: PositionFlow[];
  suspect: number;
}

/** The flows between quarter `index - 1` and quarter `index`, leaving out the funds in `blocked` as reporting changes. */
function analysePair(index: number, blocked: Set<number>): PairAnalysis {
  const quarter = quarters[index];
  const before = quarters[index - 1];
  const previous = holdings[index - 1];
  const current = holdings[index];
  const previousByFund = holdingsByFund[index - 1];
  const byFund = holdingsByFund[index];
  const counts = [
    ...[...previousByFund].map(([fund, rows]) => ({ fundCik: fund, quarterDate: before, positions: rows.length })),
    ...[...byFund].map(([fund, rows]) => ({ fundCik: fund, quarterDate: quarter, positions: rows.length })),
  ];
  const comparable = comparableFunds(counts, quarter, before);
  const stable = new Set(comparable.stable);
  const pricesBefore = impliedPrices(previous);
  const pricesNow = impliedPrices(current);
  // the books are on today's share basis already; these are the splits they absorbed in this pair of quarters
  const splits: string[] = booksManifest.splits.filter((split) => split.quarter === quarter).map((split) => `${split.ticker} ${ratioText(split.ratio)}`);
  // what a company did to its shares besides: when nearly every holder's count changes by one factor, nobody traded
  const factors = new Map<number, number>();
  {
    const sharesBefore = new Map<string, number>();
    for (const row of previous) if (stable.has(row.fund) && row.shares > 0) sharesBefore.set(`${row.fund}|${row.company}`, row.shares);
    const ratios = new Map<number, number[]>();
    for (const row of current) {
      const was = sharesBefore.get(`${row.fund}|${row.company}`);
      if (was && row.shares > 0) (ratios.get(row.company) ?? ratios.set(row.company, []).get(row.company)!).push(row.shares / was);
    }
    const holders = (rows: Holding[]) => {
      const held = new Map<number, number>();
      for (const row of rows) if (stable.has(row.fund) && row.shares > 0) held.set(row.company, (held.get(row.company) ?? 0) + 1);
      return held;
    };
    const heldBefore = holders(previous);
    const heldNow = holders(current);
    for (const [company, list] of ratios) {
      // a young listing whose float is still being released gains holders every quarter, and index funds buy what is released: that is trading
      const settled = (heldNow.get(company) ?? 0) / (heldBefore.get(company) ?? 1);
      if (settled < 0.85 || settled > 1.15) continue;
      const ratio = shareBasisChange(list);
      if (ratio !== null) {
        factors.set(company, ratio);
        splits.push(`${tickerOf(company)} ${ratioText(ratio)} (shares exchanged)`);
      }
    }
  }
  // a book moved at once is a change of what the fund reports, not trading
  const reportingChanges: number[] = [];
  for (const fund of [...stable]) {
    if (blocked.has(fund) || reportingChange(previousByFund.get(fund) ?? [], byFund.get(fund) ?? [], factors)) {
      stable.delete(fund);
      reportingChanges.push(fund);
    }
  }
  // a company most of whose holders appear at once was listed, spun off or exchanged for another security: nobody bought it in the market that quarter
  const unsized = new Set<number>();
  const holdersBefore = new Map<number, number>();
  const holdersNow = new Map<number, number>();
  for (const row of previous) if (stable.has(row.fund)) holdersBefore.set(row.company, (holdersBefore.get(row.company) ?? 0) + 1);
  for (const row of current) if (stable.has(row.fund)) holdersNow.set(row.company, (holdersNow.get(row.company) ?? 0) + 1);
  const listed: string[] = [];
  for (const [company, count] of holdersNow) {
    if (count >= 20 && (holdersBefore.get(company) ?? 0) < 0.2 * count) {
      unsized.add(company);
      listed.push(tickerOf(company));
    }
  }
  const usable = (rows: Holding[]) => rows.filter((row) => !unsized.has(row.company));
  const { flows, suspect } = positionFlows(usable(previous), usable(current), stable, factors, pricesBefore, pricesNow);
  return { comparable, stable, reportingChanges, factors, splits, listed: listed.sort(), flows, suspect };
}

// First pass: a block of holdings that enters or leaves a report in one quarter (a trust that becomes reportable, an
// acquired firm's accounts) is far outside what the fund otherwise trades and touches many positions at once.
const blockedAt = new Map<number, Set<number>>();
{
  const record = new Map<number, { index: number; ratio: number; moved: number; held: number }[]>();
  for (let index = 1; index < quarters.length; index++) {
    const pair = analysePair(index, new Set());
    const net = new Map<number, number>();
    for (const flow of pair.flows) net.set(flow.fund, (net.get(flow.fund) ?? 0) + flow.usd);
    for (const fund of pair.stable) {
      const was = holdingsByFund[index - 1].get(fund) ?? [];
      const base = sum(was.map((row) => row.value));
      if (base <= 0) continue;
      const flow = net.get(fund) ?? 0;
      const sharesBefore = new Map(was.map((row) => [row.company, row.shares * (pair.factors.get(row.company) ?? 1)]));
      let moved = 0;
      let held = 0;
      for (const row of holdingsByFund[index].get(fund) ?? []) {
        const earlier = sharesBefore.get(row.company) ?? 0;
        held++;
        if (flow > 0 ? row.shares > earlier * 1.1 : row.shares < earlier / 1.1) moved++;
      }
      (record.get(fund) ?? record.set(fund, []).get(fund)!).push({ index, ratio: flow / base, moved, held });
    }
  }
  for (const [fund, rows] of record) {
    for (const row of rows) {
      const others = rows.filter((other) => other !== row).map((other) => Math.abs(other.ratio));
      const usual = median(others) ?? 0;
      if (Math.abs(row.ratio) > Math.max(0.2, 6 * usual) && row.moved >= 20 && row.moved >= 0.1 * row.held) (blockedAt.get(row.index) ?? blockedAt.set(row.index, new Set()).get(row.index)!).add(fund);
    }
  }
}

for (let index = 0; index < quarters.length; index++) {
  const quarter = quarters[index];
  const current = holdings[index];
  const byFund = holdingsByFund[index];
  for (const [fund, rows] of byFund) {
    const state = fundQuarter.get(fund) ?? fundQuarter.set(fund, new Map()).get(fund)!;
    state.set(quarter, { tracked: sum(rows.map((row) => row.value)), positions: rows.length, bought: null, sold: null, flows: [], book: rows });
    // a holding streak starts when a filed book first shows the stock and ends when a filed book no longer does
    const held = new Set(rows.map((row) => row.company));
    const streaks = heldSince.get(fund) ?? heldSince.set(fund, new Map()).get(fund)!;
    for (const company of held) if (!streaks.has(company)) streaks.set(company, quarter);
    for (const company of [...streaks.keys()]) if (!held.has(company)) streaks.delete(company);
  }
  const perCompany = new Map<number, { holders: number; held: number }>();
  for (const row of current) {
    const entry = perCompany.get(row.company) ?? { holders: 0, held: 0 };
    entry.holders++;
    entry.held += row.value;
    perCompany.set(row.company, entry);
  }
  for (const [company, entry] of perCompany) (companyQuarter.get(company) ?? companyQuarter.set(company, new Map()).get(company)!).set(quarter, entry);

  if (index > 0) {
    const before = quarters[index - 1];
    const previous = holdings[index - 1];
    const { comparable, stable, reportingChanges, splits, listed, flows, suspect } = analysePair(index, blockedAt.get(index) ?? new Set());
    suspectPositions += suspect;
    flowsByQuarter.set(quarter, flows);
    const byFundFlows = new Map<number, PositionFlow[]>();
    const byCompanyFlows = new Map<number, PositionFlow[]>();
    for (const flow of flows) {
      (byFundFlows.get(flow.fund) ?? byFundFlows.set(flow.fund, []).get(flow.fund)!).push(flow);
      (byCompanyFlows.get(flow.company) ?? byCompanyFlows.set(flow.company, []).get(flow.company)!).push(flow);
    }
    flowsByCompany.set(quarter, byCompanyFlows);

    const sectors = new Map<string, { bought: number; sold: number; held: number }>();
    const companies = new Map<number, FlowCompanyRow>();
    const funds = new Map<number, { bought: number; sold: number; sells: Map<string, number>; buys: Map<string, number> }>();
    const heldNow = new Map<number, number>();
    for (const row of current) {
      if (!stable.has(row.fund)) continue;
      const entry = sectors.get(sectorOf(row.company)) ?? { bought: 0, sold: 0, held: 0 };
      entry.held += row.value;
      sectors.set(sectorOf(row.company), entry);
      heldNow.set(row.company, (heldNow.get(row.company) ?? 0) + row.value);
    }
    for (const flow of flows) {
      const sector = sectorOf(flow.company);
      const sectorEntry = sectors.get(sector) ?? { bought: 0, sold: 0, held: 0 };
      const company = companies.get(flow.company) ?? { cik: flow.company, ticker: tickerOf(flow.company), net: 0, bought: 0, sold: 0, buyers: 0, sellers: 0, opened: 0, closed: 0 };
      const fund = funds.get(flow.fund) ?? { bought: 0, sold: 0, sells: new Map(), buys: new Map() };
      if (flow.usd > 0) {
        sectorEntry.bought += flow.usd; company.bought += flow.usd; company.buyers++; fund.bought += flow.usd;
        fund.buys.set(sector, (fund.buys.get(sector) ?? 0) + flow.usd);
        if (flow.kind === "new") company.opened++;
      } else {
        sectorEntry.sold -= flow.usd; company.sold -= flow.usd; company.sellers++; fund.sold -= flow.usd;
        fund.sells.set(sector, (fund.sells.get(sector) ?? 0) - flow.usd);
        if (flow.kind === "exit") company.closed++;
      }
      company.net += flow.usd;
      sectors.set(sector, sectorEntry);
      companies.set(flow.company, company);
      funds.set(flow.fund, fund);
    }
    const rotation = new Map<string, number>();
    for (const [fund, entry] of funds) {
      addLinks(rotation, rotationLinks(entry.sells, entry.buys));
      const state = fundQuarter.get(fund)?.get(quarter);
      if (state) Object.assign(state, { bought: entry.bought, sold: entry.sold, flows: byFundFlows.get(fund) ?? [] });
    }
    for (const fund of stable) {
      const state = fundQuarter.get(fund)?.get(quarter);
      if (state && state.bought === null) Object.assign(state, { bought: 0, sold: 0 });
    }
    const aggregate = new Map<number, number>();
    for (const row of previous) if (stable.has(row.fund)) aggregate.set(row.company, (aggregate.get(row.company) ?? 0) + row.value);
    allFundsReturn.set(quarter, bookReturn([...aggregate].map(([company, value]) => ({ value, ret: ret(company, before, quarter) }))));
    const ranked = [...companies.values()].sort((a, b) => b.net - a.net);
    const fundRows = [...funds].map(([cik, entry]) => ({ cik, net: entry.bought - entry.sold, bought: entry.bought, sold: entry.sold })).sort((a, b) => b.net - a.net);
    const none: FlowOutcome = { bought: null, sold: null, spread: null };
    flowQuarters.push({
      quarter,
      previous: before,
      funds: stable.size,
      fundsLeftOut: comparable.missing.length + comparable.suspect.length + reportingChanges.length,
      reportingChanges: reportingChanges.map((fund) => fundNames.get(fund)?.name ?? `CIK ${fund}`).sort(),
      bought: sum(flows.filter((flow) => flow.usd > 0).map((flow) => flow.usd)),
      sold: -sum(flows.filter((flow) => flow.usd < 0).map((flow) => flow.usd)),
      net: sum(flows.map((flow) => flow.usd)),
      held: sum([...sectors.values()].map((entry) => entry.held)),
      sectors: [...sectors].map(([sector, entry]) => ({ sector, bought: entry.bought, sold: entry.sold, net: entry.bought - entry.sold, held: entry.held })).sort((a, b) => b.net - a.net),
      rotation: linksFromTotals(rotation),
      topBought: ranked.slice(0, 15),
      topSold: ranked.slice(-15).reverse(),
      topBuyers: fundRows.slice(0, 15),
      topSellers: fundRows.slice(-15).reverse(),
      companyFlows: [...heldNow].map(([company, held]) => {
        const since = ret(company, quarter, latestPriceDate);
        return [company, Math.round(companies.get(company)?.net ?? 0), Math.round(held), since === null ? null : Math.round(since * 1e4) / 1e4] as [number, number, number, number | null];
      }),
      fundFlows: [...stable].map((fund) => [fund, Math.round(funds.get(fund)?.bought ?? 0), Math.round(funds.get(fund)?.sold ?? 0)] as [number, number, number]),
      splits,
      listed,
      next1: none, next4: none, toDate: none, followed: none,
      allFundsReturn: allFundsReturn.get(quarter) ?? null,
      benchmarkReturn: ret(0, before, quarter),
      cpi: cpiAt(quarter),
    });
  }
  console.log(`[fund-flows] ${quarter}: ${byFund.size} funds, ${current.length} positions${index > 0 ? `, ${flowsByQuarter.get(quarter)!.length} flows` : ""}`);
}

// --- what followed the money ------------------------------------------------------------------------------------------------
const quarterAfter = (quarter: string, steps: number): string | null => quarters[quarters.indexOf(quarter) + steps] ?? null;
const outcomeOf = (flows: PositionFlow[], from: string, to: string | null) => flowOutcome(flows.map((flow) => ({ usd: flow.usd, ret: ret(flow.company, from, to) })));
for (const row of flowQuarters) {
  const flows = flowsByQuarter.get(row.quarter)!;
  row.next1 = outcomeOf(flows, row.quarter, quarterAfter(row.quarter, 1));
  row.next4 = outcomeOf(flows, row.quarter, quarterAfter(row.quarter, 4));
  row.toDate = outcomeOf(flows, row.quarter, latestPriceDate);
  const next = quarterAfter(row.quarter, 1);
  const end = next ? filingDeadline(next) : null;
  row.followed = outcomeOf(flows, filingDeadline(row.quarter), end && latestPriceDate && end <= latestPriceDate ? end : null);
}

// --- funds --------------------------------------------------------------------------------------------------------------------------
const latest = quarters.at(-1)!;
const first = quarters[0];
const latestHoldings = holdings.at(-1)!;
const allFundsBook = new Map<string, number>();
for (const row of latestHoldings) allFundsBook.set(sectorOf(row.company), (allFundsBook.get(sectorOf(row.company)) ?? 0) + row.value);
const allFundsTotal = sum([...allFundsBook.values()]);
const weights = new Map<number, Map<number, number>>();
const fundFiles: FundFlowsFund[] = [];
for (const [fund, states] of fundQuarter) {
  const meta = fundNames.get(fund) ?? { name: `CIK ${fund}`, tier: null };
  const filed = quarters.filter((quarter) => states.has(quarter));
  const lastFiled = filed.at(-1)!;
  const state = states.get(lastFiled)!;
  let growth: number | null = null;
  let growthAll: number | null = null;
  let growthStart: string | null = null;
  const series: FundSeriesPoint[] = [];
  const turnovers: number[] = [];
  const bought4: number[] = [];
  const sold4: number[] = [];
  for (const quarter of filed) {
    const at = states.get(quarter)!;
    const before = quarters[quarters.indexOf(quarter) - 1];
    const prior = before ? states.get(before) : undefined;
    const paper = prior ? bookReturn(prior.book.map((row) => ({ value: row.value, ret: ret(row.company, before, quarter) }))) : null;
    if (paper !== null) {
      growthStart ??= before;
      growth = (growth ?? 1) * (1 + paper);
      const market = allFundsReturn.get(quarter);
      growthAll = market === null || market === undefined ? growthAll : (growthAll ?? 1) * (1 + market);
    }
    if (at.bought !== null && at.sold !== null && prior) {
      const average = (prior.tracked + at.tracked) / 2;
      if (average > 0) turnovers.push(Math.min(at.bought, at.sold) / average);
    }
    const next4 = at.flows.length ? outcomeOf(at.flows, quarter, quarterAfter(quarter, 4)) : { bought: null, sold: null, spread: null };
    if (next4.bought !== null) bought4.push(next4.bought);
    if (next4.sold !== null) sold4.push(next4.sold);
    series.push({ quarter, tracked: at.tracked, book: books.get(`${fund}|${quarter}`) ?? null, positions: at.positions, bought: at.bought, sold: at.sold, net: at.bought !== null && at.sold !== null ? at.bought - at.sold : null, paperReturn: paper, growth, growthAllFunds: growthAll, cpi: cpiAt(quarter), next4 });
  }
  const shape = bookShape(state.book.map((row) => row.value));
  const turnover = median(turnovers.slice(-8));
  const sectorWeights = new Map<string, number>();
  for (const row of state.book) sectorWeights.set(sectorOf(row.company), (sectorWeights.get(sectorOf(row.company)) ?? 0) + row.value / (state.tracked || 1));
  const sectors = [...new Set([...allFundsBook.keys(), ...sectorWeights.keys()])].map((sector) => ({ sector, weight: sectorWeights.get(sector) ?? 0, allFunds: allFundsTotal ? (allFundsBook.get(sector) ?? 0) / allFundsTotal : 0 }));
  const leans = [...sectors].sort((a, b) => b.weight - b.allFunds - (a.weight - a.allFunds));
  const fundShape = {
    tracked: state.tracked,
    book: books.get(`${fund}|${lastFiled}`) ?? null,
    positions: state.positions,
    ...shape,
    turnover,
    holdingYears: turnover && turnover > 0 ? Math.min(25, 1 / (4 * turnover)) : null,
    over: leans.length ? { sector: leans[0].sector, points: leans[0].weight - leans[0].allFunds } : null,
    under: leans.length ? { sector: leans.at(-1)!.sector, points: leans.at(-1)!.weight - leans.at(-1)!.allFunds } : null,
  };
  const latestFlows = [...state.flows].sort((a, b) => b.usd - a.usd);
  const cpiStart = growthStart ? cpiAt(growthStart) : null;
  const cpiEnd = cpiAt(lastFiled);
  const mean = (values: number[]) => (values.length ? sum(values) / values.length : null);
  const flowOf = new Map(state.flows.map((flow) => [flow.company, flow.usd]));
  const moves = [...filed].reverse().filter((quarter) => states.get(quarter)!.flows.length).map((quarter) => {
    const ordered = [...states.get(quarter)!.flows].sort((a, b) => b.usd - a.usd);
    const move = (flow: PositionFlow): FundMove => ({ cik: flow.company, ticker: tickerOf(flow.company), usd: Math.round(flow.usd), kind: flow.kind, since: ret(flow.company, quarter, latestPriceDate) });
    return { quarter, buys: ordered.filter((flow) => flow.usd > 0).slice(0, 12).map(move), sells: ordered.filter((flow) => flow.usd < 0).slice(-12).reverse().map(move) };
  });
  if (lastFiled === latest) weights.set(fund, new Map(state.book.map((row) => [row.company, row.value / (state.tracked || 1)])));
  const category = fundCategory(meta.name, meta.tier, fundShape, FUND_NOTES[fund]?.category);
  const options = filedBooks.get(`${fund}|${lastFiled}`)?.optionsCovered ?? null;
  fundFiles.push({
    cik: fund,
    name: meta.name,
    category,
    tags: styleTags(fundShape),
    options: options && options.puts + options.calls > 0 ? options : null,
    story: fundStory(fundShape, {
      options,
      firstQuarter: growthStart ?? filed[0],
      latestQuarter: lastFiled,
      growth,
      growthAllFunds: growthAll,
      realGrowth: growth !== null && cpiStart && cpiEnd ? growth / (cpiEnd / cpiStart) : null,
      tradeBought4: mean(bought4),
      tradeSold4: mean(sold4),
      latestNet: state.bought !== null && state.sold !== null ? state.bought - state.sold : null,
      biggestBuy: latestFlows[0]?.usd > 0 ? tickerOf(latestFlows[0].company) : null,
      biggestSale: latestFlows.at(-1) && latestFlows.at(-1)!.usd < 0 ? tickerOf(latestFlows.at(-1)!.company) : null,
    }),
    latestQuarter: lastFiled,
    tracked: state.tracked,
    book: fundShape.book,
    positions: state.positions,
    top10Share: shape.top10Share,
    effectivePositions: shape.effectivePositions,
    turnover,
    holdingYears: fundShape.holdingYears,
    series,
    sectors: sectors.sort((a, b) => b.weight - a.weight),
    topPositions: [...state.book].sort((a, b) => b.value - a.value).slice(0, 25).map((row) => ({
      cik: row.company, ticker: tickerOf(row.company), name: directory.get(row.company)?.name ?? tickerOf(row.company), sector: sectorOf(row.company),
      usd: row.value, weight: row.value / (state.tracked || 1), heldSince: heldSince.get(fund)?.get(row.company) ?? lastFiled, flow: flowOf.get(row.company) ?? 0,
    })),
    moves,
    alike: [],
  });
}
// which books resemble each other (only funds that filed the latest quarter)
for (const file of fundFiles) {
  const own = weights.get(file.cik);
  if (!own) continue;
  file.alike = [...weights]
    .filter(([other]) => other !== file.cik)
    .map(([other, book]) => ({ cik: other, name: fundNames.get(other)?.name ?? `CIK ${other}`, overlap: overlap(own, book) }))
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 6);
}

// --- companies -------------------------------------------------------------------------------------------------------------------------
const companyFiles: FundFlowsCompany[] = [];
const fundName = (fund: number) => fundNames.get(fund)?.name ?? `CIK ${fund}`;
const latestTracked = new Map<number, number>();
const latestByCompany = new Map<number, Holding[]>();
for (const row of latestHoldings) {
  latestTracked.set(row.fund, (latestTracked.get(row.fund) ?? 0) + row.value);
  (latestByCompany.get(row.company) ?? latestByCompany.set(row.company, []).get(row.company)!).push(row);
}
for (const [company, perQuarter] of companyQuarter) {
  const meta = directory.get(company);
  if (!meta) continue;
  const series = flowQuarters.map((row) => {
    const flows = flowsByCompany.get(row.quarter)!.get(company) ?? [];
    const stats = perQuarter.get(row.quarter) ?? { holders: 0, held: 0 };
    const bought = sum(flows.filter((flow) => flow.usd > 0).map((flow) => flow.usd));
    const sold = -sum(flows.filter((flow) => flow.usd < 0).map((flow) => flow.usd));
    return {
      quarter: row.quarter, net: bought - sold, bought, sold,
      buyers: flows.filter((flow) => flow.usd > 0).length, sellers: flows.filter((flow) => flow.usd < 0).length,
      opened: flows.filter((flow) => flow.kind === "new").length, closed: flows.filter((flow) => flow.kind === "exit").length,
      holders: stats.holders, held: stats.held,
      next1: ret(company, row.quarter, quarterAfter(row.quarter, 1)), next4: ret(company, row.quarter, quarterAfter(row.quarter, 4)),
    };
  });
  const side = (flows: PositionFlow[]): CompanyFundRow[] => flows.map((flow) => ({ cik: flow.fund, name: fundName(flow.fund), usd: flow.usd, kind: flow.kind }));
  companyFiles.push({
    cik: company,
    ticker: meta.ticker,
    name: meta.name,
    sector: meta.sector,
    series,
    holders: [...(latestByCompany.get(company) ?? [])].sort((a, b) => b.value - a.value).slice(0, 20).map((row) => ({ cik: row.fund, name: fundName(row.fund), usd: row.value, weight: row.value / (latestTracked.get(row.fund) || 1) })),
    quarters: [...flowQuarters].reverse().map((row) => {
      const ordered = [...(flowsByCompany.get(row.quarter)!.get(company) ?? [])].sort((a, b) => b.usd - a.usd);
      return { quarter: row.quarter, buyers: side(ordered.filter((flow) => flow.usd > 0).slice(0, 12)), sellers: side(ordered.filter((flow) => flow.usd < 0).slice(-12).reverse()) };
    }),
  });
}

// --- overview --------------------------------------------------------------------------------------------------------------------------
const lastFlows = flowQuarters.at(-1)!;
const lastCompanyNet = new Map<number, number>();
for (const flow of flowsByQuarter.get(lastFlows.quarter)!) lastCompanyNet.set(flow.company, (lastCompanyNet.get(flow.company) ?? 0) + flow.usd);
const overview: FundFlowsOverview = {
  schemaVersion: FUND_FLOWS_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  codeVersion,
  books: { generatedAt: booksManifest.generatedAt, codeVersion: booksManifest.codeVersion, filings: booksManifest.filings.total },
  firstQuarter: first,
  latestQuarter: latest,
  openQuarter: open ? { quarter: open.q, funds: Number(open.funds) } : null,
  latestPriceDate,
  quarters: flowQuarters,
  funds: fundFiles
    .map((file) => {
      const lastPoint = file.series.at(-1)!;
      const spreads = file.series.map((point) => point.next4.spread).filter((value): value is number => value !== null);
      return {
        cik: file.cik, name: file.name, category: file.category, tags: file.tags, latestQuarter: file.latestQuarter, tracked: file.tracked, book: file.book, positions: file.positions,
        top10Share: file.top10Share, turnover: file.turnover, quarters: file.series.length, net: file.latestQuarter === latest ? lastPoint.net : null,
        growth: lastPoint.growth, growthAllFunds: lastPoint.growthAllFunds, tradeSpread4: spreads.length ? sum(spreads) / spreads.length : null,
      };
    })
    // funds that report today first, the largest first; then those whose last report is older
    .sort((a, b) => Number(b.latestQuarter === latest) - Number(a.latestQuarter === latest) || b.tracked - a.tracked),
  companies: companyFiles
    .map((file) => ({ cik: file.cik, ticker: file.ticker, name: file.name, sector: file.sector, held: companyQuarter.get(file.cik)?.get(latest)?.held ?? 0, holders: companyQuarter.get(file.cik)?.get(latest)?.holders ?? 0, net: lastCompanyNet.get(file.cik) ?? 0 }))
    .filter((row) => row.held > 0)
    .sort((a, b) => b.held - a.held),
};

const hits = flowQuarters.filter((row) => row.next1.spread !== null);
const summary = `[fund-flows] ${flowQuarters.length} flow quarters ${flowQuarters[0].quarter}..${lastFlows.quarter} · ${overview.funds.length} funds · ${overview.companies.length} companies · latest: bought $${(lastFlows.bought / 1e9).toFixed(0)}bn, sold $${(lastFlows.sold / 1e9).toFixed(0)}bn (${lastFlows.funds} funds) · splits corrected ${sum(flowQuarters.map((row) => row.splits.length))} · unit-error positions left out ${suspectPositions} · next-quarter spread positive in ${hits.filter((row) => row.next1.spread! > 0).length}/${hits.length} quarters · code ${codeVersion}`;
if (dryRun) {
  console.log(`${summary} · dry run, nothing written`);
} else {
  writeJsonAtomic(path.join(OUT, "overview.json"), overview);
  for (const file of fundFiles) writeJsonAtomic(path.join(OUT, "fund", `${file.cik}.json`), file);
  for (const file of companyFiles) writeJsonAtomic(path.join(OUT, "company", `${file.cik}.json`), file);
  console.log(`${summary} · ${OUT}`);
}
process.exit(0);
