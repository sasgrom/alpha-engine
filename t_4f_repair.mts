/**
 * 4f repair (D37): re-ingest AAPL XBRL facts (wiped by the 2026-10-12
 * cancel-between-wipe-and-refill incident — the transactional
 * replaceCompanyFacts is the fixed path), then rebuild canonical series for
 * EVERY company with the new generalized quarter derivation (4f), then
 * invalidate per-user screener caches. Run: npx tsx t_4f_repair.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
import { replaceCompanyFacts } from "./api/services/runner";
import { buildCompanySeries } from "./api/services/series";
import { usersWithUniverse, invalidateScreenerCache } from "./api/services/membership";

const db = getDb();
const log = async (_l: "info" | "warn" | "error", m: string) => console.log(`[${_l}] ${m}`);

// 1. repair AAPL facts (transactional; SEC cumulative payload)
const n = await replaceCompanyFacts(320193, "AAPL", log);
if (n < 10000) throw new Error(`AAPL repair suspicious: only ${n} rows`);
console.log(`AAPL facts repaired: ${n} rows`);

// 2. rebuild series for every company that has facts (new derivation fires now)
const ciks: any = await db.execute(sql`SELECT DISTINCT cik FROM facts ORDER BY cik`);
for (const r of ciks[0]) {
  const cik = Number(r.cik);
  const res = await buildCompanySeries(cik);
  const der: any = await db.execute(
    sql`SELECT COUNT(*) n FROM series_points WHERE cik=${cik} AND derivation='derived_ytd'`
  );
  console.log(`cik=${cik}: series=${res.series} points=${res.points} derived_ytd=${der[0][0].n}`);
}

// 3. verify the review's smoking guns are gone (AAPL FQ4 FY25 + FY-annual depth)
const q4: any = await db.execute(sql`
  SELECT periodEnd, val, derivation FROM series_points
  WHERE cik=320193 AND vintage='latest' AND concept='RevenueFromContractWithCustomerExcludingAssessedTax'
    AND periodEnd IN ('2025-09-27','2024-09-28','2023-09-30') ORDER BY periodEnd`);
console.log("AAPL revenue at FY ends (was missing):");
for (const r of q4[0]) console.log(` ${String(r.periodEnd).slice(0, 10)} val=${r.val} ${r.derivation}`);

// 4. screener caches are stale vs the rebuilt series — drop them per user
for (const uid of await usersWithUniverse()) await invalidateScreenerCache(uid);
console.log("screener caches invalidated");

console.log("PASS: 4f repair + rebuild");
process.exit(0);
