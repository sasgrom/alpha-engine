/**
 * Daily digest (5e) — run at home after the morning signals settled:
 *   npx tsx scripts/daily-digest.mts [--hours 36] [--date YYYY-MM-DD]
 *
 * Reads the LOCAL signals table (last window), asks the LOCAL Ollama model
 * for a ≤250-word morning brief, and POSTs it via the worker ingest contract
 * (kind "digests"). Local-first probation like every llm: artifact: with
 * INGEST_URL=http://127.0.0.1:3000/... it lands in the local DB for eyeball
 * review; a plain `node`-rerun with the variable removed ships it to prod
 * (upsert by (kind, forDate) refreshes honestly).
 *
 * Scheduled centrally as daily-digest in contracts/operations.ts and /workers.
 * Do not create a separate AlphaEngine-Digest Windows task.
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { buildCompanyQuarterPrompt, buildDigestPrompt, quarterRange, type DigestSignal } from "../worker/lib/digest";
import { generate, LLM_MODEL, status } from "../worker/lib/ollama";
import { postDigests } from "../worker/lib/ingest";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const mode = arg("--ticker") ? "company-quarter" : "morning";
const ticker = arg("--ticker")?.toUpperCase() ?? null;
const quarter = arg("--quarter"); // 2026Q1 — required with --ticker
const hours = Number(arg("--hours") ?? 36);
const forDate = arg("--date") ?? new Date().toISOString().slice(0, 10);

const st = await status();
if (!st.ok) { console.error("[digest] Ollama daemon not reachable"); process.exit(1); }
if (!st.models.some((m) => m === LLM_MODEL || m.startsWith(`${LLM_MODEL.split(":")[0]}:`))) {
  console.error(`[digest] model ${LLM_MODEL} not pulled`); process.exit(1);
}

const db = getDb();
let prompt: string;
let digestForDate = forDate;
let scope = "";
let windowDesc: string;
if (mode === "company-quarter") {
  if (!quarter) { console.error("[digest] --quarter 2026Q1 required with --ticker"); process.exit(1); }
  const [qFrom, qTo] = quarterRange(quarter!);
  digestForDate = qTo;
  scope = ticker!;
  const [rows]: any = await db.execute(sql`
    SELECT c.ticker, s.source, s.signalType, s.eventTs, s.score, s.magnitude, s.note
    FROM signals s JOIN companies c ON c.cik = s.cik
    WHERE c.ticker = ${ticker} AND s.eventTs >= ${qFrom} AND s.eventTs < ${qTo + " 23:59:59"}
    ORDER BY s.eventTs LIMIT 300`);
  console.log(`[digest] ${ticker} ${quarter} (${qFrom}..${qTo}) → ${rows.length} signals`);
  if (rows.length === 0) { console.log("[digest] nothing to digest, exiting"); process.exit(0); }
  prompt = buildCompanyQuarterPrompt(ticker!, quarter!, rows as DigestSignal[]);
  windowDesc = `${quarter} (${rows.length} signals)`;
} else {
  const [rows]: any = await db.execute(sql`
    SELECT c.ticker, s.source, s.signalType, s.eventTs, s.score, s.magnitude, s.note
    FROM signals s LEFT JOIN companies c ON c.cik = s.cik
    WHERE s.eventTs > NOW() - INTERVAL ${hours} HOUR
    ORDER BY s.eventTs DESC LIMIT 200`);
  console.log(`[digest] window ${hours}h → ${rows.length} signals`);
  if (rows.length === 0) { console.log("[digest] nothing to digest, exiting"); process.exit(0); }
  prompt = buildDigestPrompt(forDate, rows as DigestSignal[]);
  windowDesc = `${hours}h (${rows.length} signals)`;
}
const t0 = Date.now();
const r = await generate(prompt, { numPredict: 1600 });
const body = r.text.trim().slice(0, 8000);
if (body.length < 40) { console.error("[digest] suspiciously short reply, NOT posting:", body.slice(0, 120)); process.exit(1); }
console.log(`[digest] model ${r.model} wrote ${body.length} chars in ${Math.round((Date.now() - t0) / 1000)}s`);

const rep = await postDigests([{
  kind: mode, scope, forDate: digestForDate, body, model: r.model,
  meta: JSON.stringify({ window: windowDesc, evalPerSec: r.evalPerSec }),
}]);
console.log(`[digest] ingested: ${rep.upserted} upserted → ${process.env.INGEST_URL ? "LOCAL (probation)" : "PROD"}`);
process.exit(0);
