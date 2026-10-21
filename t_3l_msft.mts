// MSFT load (3l) — replaces the mistaken MNST upload.
import { readFileSync } from "fs";
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
import { parseMetastockDaily } from "./api/services/price-import";
import { upsertBars, getBars, beta5y } from "./api/services/prices";

const bars = parseMetastockDaily(readFileSync("/mnt/agents/temp/msft.us.txt", "utf8"));
const written = await upsertBars(789019, "MSFT", bars, "stooq");
console.log(`MSFT (cik 789019): ${written} bars, ${bars[0]?.date} → ${bars[bars.length - 1]?.date}, last close ${bars[bars.length - 1]?.close}`);

const db = getDb();
const from5y = new Date(Date.now() - 5 * 365 * 86400_000).toISOString().slice(0, 10);
console.log(`beta(MSFT vs SPY) = ${beta5y(await getBars(789019, from5y), await getBars(0, from5y))?.toFixed(3)}`);
const chk: any = await db.execute(sql`SELECT ticker, COUNT(*) n FROM prices WHERE source='stooq' GROUP BY ticker ORDER BY ticker`);
console.log("prices table:", chk[0].map((r: any) => `${r.ticker}:${r.n}`).join("  "));
// sanity: nothing under a non-universe ticker
const mnst: any = await db.execute(sql`SELECT COUNT(*) n FROM prices WHERE ticker='MNST'`);
console.log("MNST rows (should be 0):", mnst[0][0].n);
process.exit(0);
