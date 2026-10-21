// Stage 1.7 final verification — per-ticker coverage vs the SPY trading
// calendar. Coverage = share of SPY trading days (within the ticker↔SPY
// overlap window) that the ticker actually has bars for.
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
import { getBars, week52 } from "./api/services/prices";

const db = getDb();

const spy: any = await db.execute(sql`SELECT date FROM prices WHERE cik=0 AND source='stooq' ORDER BY date`);
const spyDates = (spy[0] ?? []).map((r: any) => String(r.date).slice(0, 10));
const spySet = new Set(spyDates);
console.log(`SPY benchmark: ${spyDates.length} bars (${spyDates[0]} → ${spyDates[spyDates.length - 1]})`);
if (spyDates.length === 0) { console.log("FAIL: no SPY bars"); process.exit(1); }

const universe: any = await db.execute(sql`SELECT cik, ticker, inUniverse FROM companies ORDER BY ticker`);
console.log(`\ncompanies: ${universe[0].map((c: any) => `${c.ticker}(${c.inUniverse ? "in" : "off"})`).join(" ")}\n`);
console.log("ticker  bars   first       last        cover%  nulls  lastClose");
const worst: { t: string; cov: number }[] = [];
for (const c of universe[0]) {
  const rows: any = await db.execute(sql`SELECT date, close FROM prices WHERE cik=${c.cik} AND source='stooq' ORDER BY date`);
  const bars = rows[0] ?? [];
  if (bars.length === 0) { console.log(`${String(c.ticker).padEnd(7)}      0  —           —             —      —  —`); continue; }
  const dates = new Set(bars.map((b: any) => String(b.date).slice(0, 10)));
  const first = String(bars[0].date).slice(0, 10);
  const last = String(bars[bars.length - 1].date).slice(0, 10);
  // SPY trading days inside the overlap window [max(first, spyStart), last]
  const expected = spyDates.filter((d) => d >= (first > spyDates[0] ? first : spyDates[0]) && d <= last);
  const have = expected.filter((d) => dates.has(d)).length;
  const cov = expected.length ? (have / expected.length) * 100 : 0;
  const nulls = bars.filter((b: any) => b.close === null).length;
  console.log(
    `${String(c.ticker).padEnd(7)} ${String(bars.length).padStart(6)} ${first}  ${last}  ${cov.toFixed(1).padStart(6)}  ${String(nulls).padStart(5)}  ${bars[bars.length - 1].close}`
  );
  worst.push({ t: c.ticker, cov });
}

const dup: any = await db.execute(sql`SELECT cik, date, source, COUNT(*) n FROM prices GROUP BY cik, date, source HAVING n>1 LIMIT 5`);
console.log(`\nduplicates: ${dup[0].length === 0 ? "none (OK)" : JSON.stringify(dup[0])}`);

const t0 = universe[0].find((c: any) => c.ticker === "AAPL") ?? universe[0][0];
const bars5y = await getBars(t0.cik, new Date(Date.now() - 5 * 365 * 86400_000).toISOString().slice(0, 10));
const w = week52(bars5y);
console.log(`quote spot check ${t0.ticker}: 5y bars=${bars5y.length}, 52w high=${w.high}, low=${w.low}`);

worst.sort((a, b) => a.cov - b.cov);
console.log(`\nworst coverage: ${worst.slice(0, 5).map((w2) => `${w2.t} ${w2.cov.toFixed(1)}%`).join(", ")}`);
console.log("DONE");
process.exit(0);
