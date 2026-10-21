import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
const db = getDb();
const r: any = await db.execute(sql`SELECT cik, ticker, inUniverse FROM companies WHERE ticker IN ('AAPL','MSFT','NVDA') LIMIT 5`);
console.log("universe:", JSON.stringify(r[0]));
const p: any = await db.execute(sql`SELECT source, COUNT(*) n FROM prices GROUP BY source`);
console.log("prices now:", JSON.stringify(p[0]));
process.exit(0);
