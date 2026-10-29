/** EDGAR tone event study: post-close market-model abnormal returns, no writes. */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { getBars } from "../api/services/prices";
import { loadEdgarUniverse } from "../worker/lib/edgar";
import { marketModelEventStudy, summarizeEventStudies, type EventStudyResult } from "../api/services/event-study";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const maxEvents = Math.max(1, Math.min(1000, Number(arg("--max-events") ?? 250)));
const universe = loadEdgarUniverse("research-universe-50.json").filter((c) => !only || c.ticker === only);
if (only && !universe.length) throw new Error(`Unknown ticker ${only}`);
const db = getDb();
const from = new Date(Date.now() - 7 * 365 * 86400_000).toISOString().slice(0, 10);
const clean = async (cik: number) => (await getBars(cik, from)).filter((b) => (b.adjClose ?? b.close) !== null)
  .map((b) => ({ date: b.date, close: Number(b.adjClose ?? b.close) })).sort((a, b) => a.date.localeCompare(b.date));
const spyBars = await clean(0);
const groups = { all: [] as EventStudyResult[], positive: [] as EventStudyResult[], negative: [] as EventStudyResult[] };
const resultCik = new Map<EventStudyResult, number>();
const companies: any[] = [];
for (const co of universe) {
  const [rows]: any = await db.execute(sql`SELECT eventTs, score FROM signals WHERE cik=${co.cik} AND source='edgar' AND signalType='tone' AND score IS NOT NULL ORDER BY eventTs DESC LIMIT ${maxEvents}`);
  const bars = await clean(co.cik);
  const results: EventStudyResult[] = [];
  for (const row of rows.reverse()) {
    const result = marketModelEventStudy(bars, spyBars, String(row.eventTs).slice(0, 10), { session: "post_close", horizon: 63 });
    if (!result) continue;
    results.push(result);
    resultCik.set(result, co.cik);
    groups.all.push(result);
    const score = Number(row.score);
    if (score >= 0.2) groups.positive.push(result);
    if (score <= -0.2) groups.negative.push(result);
  }
  companies.push({ ticker: co.ticker, cik: co.cik, filings: rows.length, usableEvents: results.length, first: results[0]?.startDate ?? null, last: results.at(-1)?.startDate ?? null });
  console.error(`[tone-event] ${co.ticker}: ${results.length}/${rows.length} usable events`);
}
const horizons = [1, 5, 21, 63];
const out: any = { policy: { session: "post_close", model: "market OLS, 120 estimation returns, minimum 60", scoreGroups: "positive >= 0.2; negative <= -0.2" }, companies, results: {} };
for (const [name, results] of Object.entries(groups)) {
  out.results[name] = { events: results.length, horizons: {} };
  for (const h of horizons) out.results[name].horizons[h] = summarizeEventStudies(results, h);
}
out.independentUniverses = {};
for (const [name, parity] of [["oddCik", 1], ["evenCik", 0]] as const) {
  out.independentUniverses[name] = {};
  for (const [group, results] of Object.entries(groups)) {
    const subset = results.filter((r) => (resultCik.get(r)! % 2) === parity);
    out.independentUniverses[name][group] = { events: subset.length, car63: summarizeEventStudies(subset, 63) };
  }
}
out.yearly63 = {};
for (const year of [...new Set(groups.all.map((r) => r.startDate.slice(0, 4)))].sort()) {
  out.yearly63[year] = {};
  for (const [group, results] of Object.entries(groups)) {
    const subset = results.filter((r) => r.startDate.startsWith(year));
    out.yearly63[year][group] = { events: subset.length, ...summarizeEventStudies(subset, 63) };
  }
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);
