/**
 * Local→prod signals push (5b/D50). The EDGAR pipeline scores ONCE into the
 * local DB; this script copies the new rows to prod — no re-scoring, no
 * re-fetching. Watermark = max pushed signals.id (worker/cache/push-watermark.json),
 * so reruns send only what's new; prod INSERT IGNORE dedupes anyway.
 *
 * Only rows of the given source are pushed (default: edgar) — live collectors
 * (stocktwits/gdelt) already ship straight to prod.
 *
 * Prod restamps ingestedAt at receipt — honest (arrival-at-prod time); the
 * no-lookahead anchor for these rows is src='backfill' + payloadKey lineage.
 *
 * Run:   npx tsx scripts/push-local-signals.mts [--source edgar] [--dry]
 * Note:  targets PROD by default regardless of INGEST_URL in .env (that var
 *        points the COLLECTORS at the local server; this script is the push).
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { postSignals, type SignalRow } from "../worker/lib/ingest";

const PROD_INGEST = "https://alphadelta-2.kimi.pro/api/worker/ingest";
const WM_FILE = path.resolve(import.meta.dirname, "..", "worker", "cache", "push-watermark.json");

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};
const source = arg("--source") ?? "edgar";
const dry = process.argv.includes("--dry");
// --reset: ignore the watermark (re-send everything local has for the source;
// prod dedupes) — used after healing prod (e.g. rows pushed without notes).
if (process.argv.includes("--reset")) saveWatermark(0);

function loadWatermark(): number {
  try { return Number(JSON.parse(readFileSync(WM_FILE, "utf8"))[source] ?? 0); } catch { return 0; }
}
function saveWatermark(id: number) {
  let all: Record<string, number> = {};
  try { all = JSON.parse(readFileSync(WM_FILE, "utf8")); } catch {}
  all[source] = id;
  mkdirSync(path.dirname(WM_FILE), { recursive: true });
  writeFileSync(WM_FILE, JSON.stringify(all, null, 1));
}

const lastId = loadWatermark();
const db = getDb();
const [rows]: any = await db.execute(
  sql`SELECT id, cik, source, signalType, eventTs, score, magnitude, payloadKey, src
      FROM signals WHERE source = ${source} AND id > ${lastId} ORDER BY id`
);
console.log(`[push] source=${source}: ${rows.length} local rows after watermark id>${lastId}`);
if (rows.length === 0) { console.log("[push] nothing to do"); process.exit(0); }

const mapped: SignalRow[] = rows.map((r: any) => ({
  cik: r.cik,
  source: r.source,
  signalType: r.signalType,
  eventTs: typeof r.eventTs === "string" ? r.eventTs : new Date(r.eventTs).toISOString().slice(0, 19).replace("T", " "),
  score: r.score,
  magnitude: r.magnitude,
  payloadKey: r.payloadKey,
  src: r.src ?? "backfill",
  note: r.note ?? null, // 5c: model rationale rides along (5b forgot it — found on first push)
}));
const maxId = Number(rows[rows.length - 1].id);

if (dry) {
  console.log(`[push] DRY: would push ${mapped.length} rows (ids up to ${maxId}); sample key: ${mapped[0]?.payloadKey}`);
  process.exit(0);
}

process.env.INGEST_URL = PROD_INGEST; // collectors' local override must not apply here
const rep = await postSignals(mapped);
saveWatermark(maxId);
console.log(`[push] ingested: ${rep.accepted} new, ${rep.skippedDupes} dupes (${rep.batches} batches); watermark → ${maxId}`);
process.exit(0);
