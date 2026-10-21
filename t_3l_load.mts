// Direct Metastock-file load (3l, user directive): parse each uploaded
// *.us.txt and upsert under source='stooq'. Same parser/upsert as the bulk
// import — identical bar semantics. Read-only on companies (no new rows).
import { readFileSync } from "fs";
import { getDb } from "./api/queries/connection";
import { companies } from "@db/schema";
import { inArray, sql } from "drizzle-orm";
import { parseMetastockDaily } from "./api/services/price-import";
import { upsertBars } from "./api/services/prices";

const FILES: [string, string][] = [
  ["AAPL", "/mnt/agents/temp/aapl.us.txt"],
  ["NVDA", "/mnt/agents/temp/nvda.us.txt"],
  ["PLD", "/mnt/agents/temp/pld.us.txt"],
  ["T", "/mnt/agents/temp/t.us.txt"],
];

const db = getDb();
const rows = await db
  .select({ cik: companies.cik, ticker: companies.ticker })
  .from(companies)
  .where(inArray(companies.ticker, FILES.map(([t]) => t)));
const byTicker = new Map(rows.map((r) => [r.ticker, r.cik]));

for (const [ticker, path] of FILES) {
  const cik = byTicker.get(ticker);
  if (!cik) { console.log(`${ticker}: NOT in companies — skipped`); continue; }
  const bars = parseMetastockDaily(readFileSync(path, "utf8"));
  const written = await upsertBars(cik, ticker, bars, "stooq");
  console.log(`${ticker} (cik ${cik}): ${written} bars, ${bars[0]?.date} → ${bars[bars.length - 1]?.date}, last close ${bars[bars.length - 1]?.close}`);
}

const chk: any = await db.execute(sql`SELECT ticker, COUNT(*) n, MIN(date) mn, MAX(date) mx FROM prices WHERE source='stooq' GROUP BY ticker ORDER BY ticker`);
console.log("\nprices now:"); chk[0].forEach((r: any) => console.log(` ${r.ticker}: ${r.n} bars, ${String(r.mn).slice(0,10)} → ${String(r.mx).slice(0,10)}`));
process.exit(0);
