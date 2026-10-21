import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
const db = getDb();
const j: any = await db.execute(sql`SELECT id, status, processed, total, message, params FROM jobs WHERE type='prices' ORDER BY id DESC LIMIT 1`);
console.log("job:", JSON.stringify(j[0][0]));
const id = j[0][0]?.id;
if (id) {
  const logs: any = await db.execute(sql`SELECT level, message FROM job_logs WHERE jobId=${id} ORDER BY id`);
  (logs[0] ?? []).forEach((l: any) => console.log(`  [${l.level}] ${l.message}`));
}
const aapl: any = await db.execute(sql`SELECT COUNT(*) n, MIN(date) mn, MAX(date) mx FROM prices WHERE cik=320193 AND source='stooq'`);
console.log("AAPL:", JSON.stringify(aapl[0][0]));
const spy: any = await db.execute(sql`SELECT COUNT(*) n FROM prices WHERE cik=0 AND ticker='SPY' AND source='stooq'`);
console.log("SPY:", JSON.stringify(spy[0][0]));
const zzz: any = await db.execute(sql`SELECT COUNT(*) n FROM prices WHERE ticker='ZZZNOPE'`);
console.log("ZZZNOPE:", JSON.stringify(zzz[0][0]));
const s: any = await db.execute(sql`SELECT date, open, close, adjClose, volume FROM prices WHERE cik=320193 AND source='stooq' ORDER BY date LIMIT 1`);
console.log("sample:", JSON.stringify(s[0][0]));
process.exit(0);
