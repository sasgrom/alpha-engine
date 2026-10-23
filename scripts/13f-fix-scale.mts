/**
 * 13f scale fix-up (one-shot): re-normalize STORED fund_holdings for filings
 * that reported value in dollars instead of thousands (Point72 proven). For
 * each (fundCik, quarterDate): median implied price over the stored rows; if
 * > $5,000 → divide valueUsd by 1000 for that filing. Idempotent (a fixed
 * filing's median lands in the $1–$1,000 band, never re-triggers).
 * Run: npx tsx scripts/13f-fix-scale.mts [--dry]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const dry = process.argv.includes("--dry");
const db = getDb();
const [filings]: any = await db.execute(sql`SELECT DISTINCT fundCik, quarterDate FROM fund_holdings`);
let fixed = 0, rowsFixed = 0;
for (const f of filings) {
  const [rows]: any = await db.execute(
    sql`SELECT id, shares, valueUsd FROM fund_holdings WHERE fundCik=${f.fundCik} AND quarterDate=${f.quarterDate} AND shares > 0 AND valueUsd IS NOT NULL`
  );
  const implied = rows.map((r: any) => Number(r.valueUsd) / Number(r.shares)).sort((a: number, b: number) => a - b);
  if (implied.length < 5) continue;
  const median = implied[Math.floor(implied.length / 2)];
  if (median <= 5000) continue;
  fixed++;
  rowsFixed += rows.length;
  if (!dry) {
    await db.execute(
      sql`UPDATE fund_holdings SET valueUsd = ROUND(valueUsd / 1000) WHERE fundCik=${f.fundCik} AND quarterDate=${f.quarterDate}`
    );
  }
  console.log(`${f.fundCik} ${f.quarterDate}: median implied $${Math.round(median).toLocaleString("en-US")} → ÷1000 (${rows.length} rows)${dry ? " [dry]" : ""}`);
}
console.log(`filings rescaled: ${fixed} (${rowsFixed} rows)${dry ? " [dry]" : ""}`);
process.exit(0);
