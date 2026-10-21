import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
const db = getDb();
const r: any = await db.execute(sql`SELECT periodEnd, val, derivation, startDate, DATEDIFF(periodEnd,startDate) dur FROM series_points WHERE cik=320193 AND concept='EarningsPerShareDiluted' AND vintage='latest' ORDER BY periodEnd DESC LIMIT 8`);
r[0].forEach((x: any) => console.log(String(x.periodEnd).slice(0,10), x.val, x.derivation, "dur", x.dur));
process.exit(0);
