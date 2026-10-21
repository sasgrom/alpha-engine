/** 4e review probe 7: does derived_q4 fire at all? What carries FQ4 cells? */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

const d: any = await db.execute(sql`SELECT derivation, COUNT(*) n FROM series_points GROUP BY derivation`);
console.log("== derivation counts ==", JSON.stringify(d[0]));

const ex: any = await db.execute(sql`
  SELECT cik, concept, periodEnd, val, vintage, sourceFiled FROM series_points
  WHERE derivation <> 'reported' ORDER BY id DESC LIMIT 8`);
console.log("== latest derived rows ==");
for (const r of ex[0]) console.log(` ${r.cik} ${r.concept} ${String(r.periodEnd).slice(0,10)} ${r.vintage} val=${r.val} filed=${String(r.sourceFiled).slice(0,10)}`);

// what carries AAPL FQ4 FY25 (2025-09-27) net income?
const ni: any = await db.execute(sql`
  SELECT concept, vintage, val, derivation, sourceFiled FROM series_points
  WHERE cik=320193 AND periodEnd='2025-09-27' AND vintage='latest'
    AND concept IN ('NetIncomeLoss','ProfitLoss','RevenueFromContractWithCustomerExcludingAssessedTax','OperatingIncomeLoss')`);
console.log("== AAPL 2025-09-27 key concepts ==");
for (const r of ni[0]) console.log(` ${r.concept} ${r.vintage} val=${r.val} ${r.derivation} filed=${String(r.sourceFiled).slice(0,10)}`);

// how MANY Q4-end points exist across companies vs Q1-Q3 ends? (fiscal-month check via month of periodEnd)
const mm: any = await db.execute(sql`
  SELECT MONTH(periodEnd) m, COUNT(*) n FROM series_points WHERE vintage='latest' GROUP BY MONTH(periodEnd) ORDER BY m`);
console.log("== points by period-end month ==", JSON.stringify(mm[0].map((r: any) => `${r.m}:${r.n}`)));
process.exit(0);
