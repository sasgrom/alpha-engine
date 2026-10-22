/**
 * Local dev seed (5b): prepare the LOCAL database for the EDGAR local-first
 * loop. Idempotent.
 *   1. Inserts the three new EDGAR companies (META/IBM/LMT) into `companies`
 *      — locally first; prod gets them with the first real ingest push.
 *   2. Registers the WORKER_KEY from .env in `worker_keys` (label
 *      "home-mbp-win") so the LOCAL ingest endpoint accepts the same key the
 *      worker already uses for prod.
 * Run: npx tsx scripts/seed-local-edgar.mts
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const COMPANIES = [
  { cik: 1326801, ticker: "META", name: "Meta Platforms, Inc.", sic: "7370", exchange: "Nasdaq" },
  { cik: 51143,   ticker: "IBM",  name: "INTERNATIONAL BUSINESS MACHINES CORP", sic: "3570", exchange: "NYSE" },
  { cik: 936468,  ticker: "LMT",  name: "Lockheed Martin Corp", sic: "3760", exchange: "NYSE" },
];

const db = getDb();
for (const c of COMPANIES) {
  await db.execute(
    sql`INSERT IGNORE INTO companies (cik, ticker, name, sic, exchange, inUniverse, updatedAt)
        VALUES (${c.cik}, ${c.ticker}, ${c.name}, ${c.sic}, ${c.exchange}, 1, NOW())`
  );
  console.log(`${c.ticker}: ensured in companies`);
}

const key = process.env.WORKER_KEY;
if (!key) { console.error("WORKER_KEY missing from environment (.env) — key row skipped"); }
else {
  const hash = createHash("sha256").update(key).digest("hex");
  await db.execute(
    sql`INSERT IGNORE INTO worker_keys (keyHash, label) VALUES (${hash}, ${"home-mbp-win"})`
  );
  console.log("worker key: ensured in worker_keys (label home-mbp-win)");
}
process.exit(0);
