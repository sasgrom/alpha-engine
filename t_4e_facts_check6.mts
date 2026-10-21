/** Final forensics: why FQ4 FY25 has net income but no revenue (4e review). */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
const AAPL = 320193;

for (const concept of ["NetIncomeLoss", "RevenueFromContractWithCustomerExcludingAssessedTax", "InterestExpense"]) {
  const r: any = await db.execute(sql`
    SELECT periodEnd, val, derivation, sourceFiled FROM series_points
    WHERE cik=${AAPL} AND vintage='latest' AND concept=${concept}
      AND periodEnd BETWEEN '2025-08-01' AND '2025-11-30' ORDER BY periodEnd`);
  console.log(`== ${concept} points Aug–Nov 2025 ==`);
  for (const x of r[0]) console.log(` ${String(x.periodEnd).slice(0,10)} ${x.derivation} val=${x.val} filed=${String(x.sourceFiled).slice(0,10)}`);
}

// when did series last build for AAPL?
const j: any = await db.execute(sql`
  SELECT id, status, createdAt, message FROM jobs WHERE type='series' ORDER BY id DESC LIMIT 5`);
console.log("== last series jobs ==");
for (const x of j[0]) console.log(` #${x.id} ${x.status} ${String(x.createdAt).slice(0,16)} ${String(x.message ?? "").slice(0, 80)}`);

// does the series layer have ANY FY25 12M-duration revenue? (annual derivation input)
const fy: any = await db.execute(sql`
  SELECT periodEnd, val, derivation, sourceFiled FROM series_points
  WHERE cik=${AAPL} AND vintage='latest' AND concept='RevenueFromContractWithCustomerExcludingAssessedTax'
    AND periodEnd='2025-09-27'`);
console.log("== revenue points at FY25 end (any derivation) ==", JSON.stringify(fy[0]));
process.exit(0);
