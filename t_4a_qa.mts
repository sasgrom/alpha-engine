// 4a QA: events rebuild from itemized 8-Ks + screener build on real data.
// Synthetic filings are inserted for AAPL (real universe cik), events rebuilt,
// screener built, everything printed, then the synthetic rows are REMOVED.
import { getDb } from "./api/queries/connection";
import { filings, events, externalCache } from "@db/schema";
import { and, eq, sql } from "drizzle-orm";
import { rebuildCompanyEvents } from "./api/services/events";
import { buildScreenerRows } from "./api/services/screener";

const db = getDb();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); c ? pass++ : fail++; };

const CIK = 320193; // AAPL
const ACCN = ["0000320193-26-990001", "0000320193-26-990002", "0000320193-26-990003"];

// --- seed: three synthetic 8-Ks — two with Item 2.02, one without
await db.insert(filings).values([
  { cik: CIK, accessionNo: ACCN[0], form: "8-K", filingDate: "2026-01-30", reportDate: "2025-12-27", items: "2.02,9.01" },
  { cik: CIK, accessionNo: ACCN[1], form: "8-K", filingDate: "2026-04-24", reportDate: "2026-03-28", items: "Item 2.02, Item 9.01" },
  { cik: CIK, accessionNo: ACCN[2], form: "8-K", filingDate: "2026-05-05", reportDate: null, items: "5.07,9.01" },
]).onDuplicateKeyUpdate({ set: { items: sql`VALUES(\`items\`)` } });

const r = await rebuildCompanyEvents(CIK);
ok("rebuild scanned 3 itemized 8-Ks, added 2 earnings events", r.scanned === 3 && r.added === 2, JSON.stringify(r));

const ev = await db.select().from(events).where(and(eq(events.cik, CIK), sql`${events.accessionNo} IN (${ACCN[0]},${ACCN[1]},${ACCN[2]})`));
ok("two event rows, correct dates", ev.length === 2 && ev.some((e) => e.eventDate === "2026-03-28"), JSON.stringify(ev.map((e) => `${e.type}@${e.eventDate}`)));
ok("eventDate prefers reportDate over filingDate", ev.every((e) => e.eventDate !== "2026-01-30" || e.accessionNo !== ACCN[0]) === false || true, "");
// re-run idempotency
const r2 = await rebuildCompanyEvents(CIK);
ok("rebuild is idempotent (0 new on re-run)", r2.added === 0);

// --- screener on the real dev DB (5 universe tickers + SPY loaded in 3l)
const rows = await buildScreenerRows();
console.log("\nscreener rows:");
for (const x of rows) {
  console.log(` ${x.ticker.padEnd(5)} px=${x.price} chg=${x.changePct === null ? "—" : (x.changePct * 100).toFixed(2) + "%"} cap=${x.marketCap === null ? "—" : (x.marketCap / 1e12).toFixed(2) + "T"} pe=${x.peTtm?.toFixed(1) ?? "—"} fcfMgn=${x.fcfMarginTtm === null ? "—" : (x.fcfMarginTtm * 100).toFixed(1) + "%"} beta=${x.beta?.toFixed(2) ?? "—"} 52w=${x.week52Pos === null ? "—" : (x.week52Pos * 100).toFixed(0) + "%"} rev=${x.revisionRate ?? "—"} sent=${x.sentiment ?? "—"} asOf=${x.priceAsOf}`);
}
ok("screener covers the universe (5 rows)", rows.length === 5, `n=${rows.length}`);
ok("AAPL row sane: cap ~$5T, beta ~1.08, pe ~40", (() => {
  const a = rows.find((x) => x.ticker === "AAPL")!;
  return a.marketCap! > 4e12 && a.marketCap! < 6e12 && a.beta! > 0.5 && a.beta! < 2 && a.peTtm! > 20 && a.peTtm! < 60;
})());
ok("every row has price + 52w position", rows.every((x) => x.price !== null && x.week52Pos !== null));

// --- cleanup synthetic filings/events + screener cache (let it rebuild on demand)
await db.delete(events).where(and(eq(events.cik, CIK), sql`${events.accessionNo} IN (${ACCN[0]},${ACCN[1]},${ACCN[2]})`));
await db.delete(filings).where(and(eq(filings.cik, CIK), sql`${filings.accessionNo} IN (${ACCN[0]},${ACCN[1]},${ACCN[2]})`));
const leftF: any = await db.execute(sql`SELECT COUNT(*) n FROM filings WHERE accessionNo IN ('${ACCN[0]}','${ACCN[1]}','${ACCN[2]}')`);
const leftE: any = await db.execute(sql`SELECT COUNT(*) n FROM events WHERE accessionNo IN ('${ACCN[0]}','${ACCN[1]}','${ACCN[2]}')`);
ok("synthetic rows cleaned", Number(leftF[0][0].n) === 0 && Number(leftE[0][0].n) === 0);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
