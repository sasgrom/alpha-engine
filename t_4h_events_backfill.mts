/**
 * 4h: PROD TODO from iteration 4a — backfill filings.items for every company
 * (8-K item lists from SEC submissions) and rebuild the earnings events table.
 * The exact code path the filings job uses, run from the sandbox (SEC is
 * reachable here; the shared DB serves prod).
 * Run: npx tsx t_4h_events_backfill.mts
 */
import { getDb } from "./api/queries/connection";
import { companies, filings } from "@db/schema";
import { sql } from "drizzle-orm";
import * as edgar from "./api/services/edgar";
import { rebuildAllEvents } from "./api/services/events";

const db = getDb();

const rows = await db.select({ cik: companies.cik, ticker: companies.ticker }).from(companies);
console.log(`companies: ${rows.length}`);

for (const c of rows) {
  // filingIndex carries `items` for 8-Ks (4a); the upsert fills them in place
  const idx = await edgar.filingIndex(c.cik, ["8-K"]);
  let filled = 0;
  for (const f of idx) {
    if (!f.items) continue;
    const r: any = await db.execute(
      sql`UPDATE filings SET items=${f.items} WHERE cik=${c.cik} AND accessionNo=${f.accessionNo} AND (items IS NULL OR items <> ${f.items})`
    );
    if (Number(r[0]?.affectedRows ?? 0) > 0) filled++;
  }
  console.log(`${c.ticker}: ${idx.length} 8-Ks indexed, ${filled} items filled`);
  await new Promise((r) => setTimeout(r, 300)); // fair-access pacing
}

const ev = await rebuildAllEvents();
console.log(`events rebuilt: ${ev.companies} companies scanned (${ev.scanned} itemized 8-Ks), ${ev.added} new`);
const cnt: any = await db.execute(sql`SELECT COUNT(*) n FROM events`);
console.log("events total:", cnt[0][0].n);
console.log("PASS: filings.items backfill + events rebuild");
process.exit(0);
