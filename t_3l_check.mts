import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
const db = getDb();
const u: any = await db.execute(sql`SELECT cik, ticker, name, inUniverse FROM companies ORDER BY ticker`);
u[0].forEach((r: any) => console.log(r.ticker, r.cik, "inUniverse=" + r.inUniverse, "|", String(r.name).slice(0, 40)));
const p: any = await db.execute(sql`SELECT ticker, source, COUNT(*) n FROM prices GROUP BY ticker, source`);
console.log("prices:", JSON.stringify(p[0]));
process.exit(0);
