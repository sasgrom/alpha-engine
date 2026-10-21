/** Isolate the facts-table anomaly (4e review probe 3). */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();
const [dbn]: any = await db.execute(sql`SELECT DATABASE() db`);
console.log("connected db:", dbn[0].db);

const c: any = await db.execute(sql`SELECT COUNT(*) n, MIN(endDate) mn, MAX(endDate) mx FROM facts WHERE cik=320193`);
console.log("facts AAPL total:", JSON.stringify(c[0]));

const r: any = await db.execute(sql`SELECT DISTINCT concept FROM facts WHERE cik=320193 AND (concept LIKE '%Revenue%' OR concept LIKE '%Interest%') LIMIT 20`);
console.log("revenue/interest-ish concepts present:", JSON.stringify(r[0].map((x: any) => x.concept)));

const s: any = await db.execute(sql`SELECT concept, taxonomy, unit, COUNT(*) n FROM facts WHERE cik=320193 GROUP BY concept, taxonomy, unit ORDER BY n DESC LIMIT 8`);
console.log("top AAPL fact concepts:");
for (const x of s[0]) console.log(` ${x.taxonomy}/${x.concept} [${x.unit}] n=${x.n}`);

// the same against series_points to compare sources
const sp: any = await db.execute(sql`SELECT DISTINCT concept FROM series_points WHERE cik=320193 AND concept LIKE '%Revenue%'`);
console.log("series revenue concepts:", JSON.stringify(sp[0].map((x: any) => x.concept)));

process.exit(0);
