// SPY benchmark load (3l): cik=0 pseudo-entity, source='stooq'.
import { readFileSync } from "fs";
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";
import { parseMetastockDaily } from "./api/services/price-import";
import { upsertBars, getBars, beta5y } from "./api/services/prices";

const bars = parseMetastockDaily(readFileSync("/mnt/agents/temp/spy.us.txt", "utf8"));
const written = await upsertBars(0, "SPY", bars, "stooq");
console.log(`SPY (cik 0): ${written} bars, ${bars[0]?.date} → ${bars[bars.length - 1]?.date}, last close ${bars[bars.length - 1]?.close}`);

// beta now computable? spot-check AAPL 5Y vs SPY
const db = getDb();
const from5y = new Date(Date.now() - 5 * 365 * 86400_000).toISOString().slice(0, 10);
const aapl = await getBars(320193, from5y);
const spy = await getBars(0, from5y);
console.log(`AAPL 5y bars=${aapl.length}, SPY 5y bars=${spy.length}, beta(AAPL vs SPY) = ${beta5y(aapl, spy)?.toFixed(3)}`);
const nvda = await getBars(1045810, from5y);
console.log(`beta(NVDA vs SPY) = ${beta5y(nvda, spy)?.toFixed(3)}`);
const chk: any = await db.execute(sql`SELECT ticker, COUNT(*) n FROM prices WHERE source='stooq' GROUP BY ticker ORDER BY ticker`);
console.log("prices table:", chk[0].map((r: any) => `${r.ticker}:${r.n}`).join("  "));
process.exit(0);
