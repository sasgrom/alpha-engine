/**
 * Fact-check for the owner's Fundamentals review (not a QA script — analysis).
 * Answers with data: series depth vs display limits, interest-expense concept
 * coverage quarterly vs annual, and why FQ4 columns go empty.
 * Run: npx tsx t_4e_facts_check.mts
 */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
const AAPL = 320193;

// 1) Series depth (latest vintage) for the revenue statement row
const d: any = await db.execute(sql`
  SELECT concept, kind, COUNT(*) n, MIN(periodEnd) mn, MAX(periodEnd) mx
  FROM series_points
  WHERE cik=${AAPL} AND vintage='latest' AND concept LIKE 'Revenue%'
  GROUP BY concept, kind ORDER BY n DESC LIMIT 6`);
console.log("== revenue series depth ==");
for (const r of d[0]) console.log(` ${r.concept} [${r.kind}] n=${r.n} ${String(r.mn).slice(0, 10)}..${String(r.mx).slice(0, 10)}`);

// 2) Interest-expense concepts in RAW facts: per concept, annual vs quarterly coverage
const ie: any = await db.execute(sql`
  SELECT concept,
         COUNT(*) n,
         SUM(CASE WHEN DATEDIFF(endDate, startDate) > 300 THEN 1 ELSE 0 END) AS annualish,
         SUM(CASE WHEN DATEDIFF(endDate, startDate) BETWEEN 60 AND 120 THEN 1 ELSE 0 END) AS quarterlyish,
         MIN(endDate) mn, MAX(endDate) mx
  FROM facts
  WHERE cik=${AAPL} AND concept LIKE '%Interest%' AND unit='USD'
  GROUP BY concept ORDER BY n DESC`);
console.log("== interest concepts (raw facts, by duration) ==");
for (const r of ie[0]) console.log(` ${r.concept}: n=${r.n} annual=${r.annualish} quarterly=${r.quarterlyish} ${String(r.mn).slice(0, 10)}..${String(r.mx).slice(0, 10)}`);

// 2b) same but in the SERIES layer (what the statements viewer actually reads)
const ies: any = await db.execute(sql`
  SELECT sp.concept, COUNT(*) n, MIN(sp.periodEnd) mn, MAX(sp.periodEnd) mx
  FROM series_points sp
  WHERE sp.cik=${AAPL} AND sp.vintage='latest' AND sp.concept LIKE '%Interest%'
  GROUP BY sp.concept ORDER BY n DESC`);
console.log("== interest concepts (series layer) ==");
for (const r of ies[0]) console.log(` ${r.concept}: n=${r.n} ${String(r.mn).slice(0, 10)}..${String(r.mx).slice(0, 10)}`);

// 3) Why FQ4 FY25 (2025-09-27) revenue cell is empty: what revenue points exist around FY25 Q4
const q4: any = await db.execute(sql`
  SELECT concept, periodEnd, val, derivation, sourceFiled
  FROM series_points
  WHERE cik=${AAPL} AND vintage='latest' AND kind='flow'
    AND concept IN ('RevenueFromContractWithCustomerExcludingAssessedTax','Revenues')
    AND periodEnd BETWEEN '2025-06-01' AND '2025-10-15'
  ORDER BY periodEnd`);
console.log("== AAPL revenue series points around FY25 Q4 ==");
for (const r of q4[0]) console.log(` ${String(r.periodEnd).slice(0, 10)} ${r.derivation} val=${r.val} filed=${String(r.sourceFiled).slice(0, 10)}`);

// 3b) raw facts available for FY2025 (12M) and 9M YTD revenue — the Q4 derivation inputs
const raw: any = await db.execute(sql`
  SELECT startDate, endDate, val, filed, form
  FROM facts
  WHERE cik=${AAPL} AND concept='RevenueFromContractWithCustomerExcludingAssessedTax' AND unit='USD'
    AND endDate='2025-09-27'
  ORDER BY startDate`);
console.log("== raw revenue facts ending 2025-09-27 (FY25 end) ==");
for (const r of raw[0]) console.log(` ${String(r.startDate).slice(0, 10)}..${String(r.endDate).slice(0, 10)} val=${r.val} form=${r.form} filed=${String(r.filed).slice(0, 10)}`);

process.exit(0);
