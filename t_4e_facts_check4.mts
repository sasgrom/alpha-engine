/** Facts distribution per company in the (new) prod DB — 4e review probe 4. */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
const g: any = await db.execute(sql`SELECT cik, COUNT(*) n, MIN(filed) mn, MAX(filed) mx FROM facts GROUP BY cik ORDER BY n DESC`);
console.log("facts per cik:");
for (const r of g[0]) console.log(` cik=${r.cik} n=${r.n} filed ${String(r.mn).slice(0,10)}..${String(r.mx).slice(0,10)}`);

// and what companies exist
const c: any = await db.execute(sql`SELECT cik, ticker FROM companies ORDER BY ticker`);
console.log("companies:", JSON.stringify(c[0].map((x: any) => `${x.ticker}:${x.cik}`)));
process.exit(0);
