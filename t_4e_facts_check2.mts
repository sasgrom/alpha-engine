/** Follow-up probes (4e review): unit filter sanity + FY25 10-K presence. */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
const AAPL = 320193;

// units actually stored for the revenue concept
const u: any = await db.execute(sql`
  SELECT unit, COUNT(*) n FROM facts
  WHERE cik=${AAPL} AND concept='RevenueFromContractWithCustomerExcludingAssessedTax'
  GROUP BY unit`);
console.log("== revenue units ==");
for (const r of u[0]) console.log(` unit=${r.unit} n=${r.n}`);

// any revenue facts ending in Sep 2025, no unit filter
const r1: any = await db.execute(sql`
  SELECT startDate, endDate, val, unit, filed, form, accn FROM facts
  WHERE cik=${AAPL} AND concept='RevenueFromContractWithCustomerExcludingAssessedTax'
    AND endDate BETWEEN '2025-09-01' AND '2025-10-15'
  ORDER BY startDate LIMIT 10`);
console.log("== revenue facts ending Sep-2025 ==");
for (const r of r1[0]) console.log(` ${String(r.startDate).slice(0,10)}..${String(r.endDate).slice(0,10)} val=${r.val} unit=${r.unit} form=${r.form} filed=${String(r.filed).slice(0,10)}`);

// which filings do we have for FY25 Q4 window at all?
const f: any = await db.execute(sql`
  SELECT form, filingDate, reportDate, accessionNo FROM filings
  WHERE cik=${AAPL} AND filingDate BETWEEN '2025-09-01' AND '2026-02-15'
  ORDER BY filingDate`);
console.log("== AAPL filings Sep-2025..Feb-2026 ==");
for (const r of f[0]) console.log(` ${r.form} filed=${String(r.filingDate).slice(0,10)} report=${String(r.reportDate).slice(0,10)}`);

// interest concepts in raw facts WITHOUT the unit filter
const ie: any = await db.execute(sql`
  SELECT concept, unit, COUNT(*) n, MIN(endDate) mn, MAX(endDate) mx
  FROM facts WHERE cik=${AAPL} AND concept LIKE '%Interest%'
  GROUP BY concept, unit ORDER BY n DESC LIMIT 12`);
console.log("== interest raw facts (any unit) ==");
for (const r of ie[0]) console.log(` ${r.concept} [${r.unit}] n=${r.n} ${String(r.mn).slice(0,10)}..${String(r.mx).slice(0,10)}`);

process.exit(0);
