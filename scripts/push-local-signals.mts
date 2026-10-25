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
// --table fund_holdings: holdings; --table fund_quarters: full-book snapshots
const table = arg("--table") ?? "signals";
const dry = process.argv.includes("--dry");
const fullSnapshot = process.argv.includes("--full");
const resumeSnapshot = process.argv.includes("--resume");
// holdings get their own watermark key — never collide with signal sources
const source = table === "fund_holdings" ? "holdings" : table === "fund_quarters" ? "fund_quarters" : (arg("--source") ?? "edgar");
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

const lastId = table === "fund_holdings" && fullSnapshot && !resumeSnapshot ? 0 : loadWatermark();
const db = getDb();

// 5g: holdings push path (13F positions) — same watermark discipline
if (table === "fund_holdings") {
  const [rows]: any = await db.execute(
    sql`SELECT id, fundCik, fundName, cusip, secClass, heldCik, issuer, shares, valueUsd, quarterDate, accessionNo, tier
        FROM fund_holdings WHERE id > ${lastId} ORDER BY id`
  );
  console.log(fullSnapshot
    ? `[push] fund_holdings: ${resumeSnapshot ? "RESUME " : ""}FULL snapshot of ${rows.length} rows after id>${lastId} (upsert, no deletes)`
    : `[push] fund_holdings: ${rows.length} local rows after watermark id>${lastId}`);
  if (rows.length === 0) { console.log("[push] nothing to do"); process.exit(0); }
  const mapped = rows.map((r: any) => ({
    fundCik: Number(r.fundCik), fundName: String(r.fundName), cusip: String(r.cusip),
    secClass: String(r.secClass ?? "COM"), heldCik: r.heldCik !== null ? Number(r.heldCik) : null,
    issuer: r.issuer ?? null, shares: r.shares !== null ? Number(r.shares) : null,
    valueUsd: r.valueUsd !== null ? Number(r.valueUsd) : null,
    quarterDate: typeof r.quarterDate === "string" ? r.quarterDate.slice(0, 10) : new Date(r.quarterDate).toISOString().slice(0, 10),
    accessionNo: String(r.accessionNo), tier: r.tier ?? null,
  }));
  const maxId = Number(rows[rows.length - 1].id);
  if (dry) { console.log(`[push] DRY: would ${fullSnapshot ? "upsert FULL snapshot" : "push"} ${mapped.length} holdings (ids up to ${maxId})`); process.exit(0); }
  const key = process.env.WORKER_KEY;
  if (!key) throw new Error("WORKER_KEY missing");
  let accepted = 0, dupes = 0, batches = 0, upserted = 0;
  for (let i = 0; i < mapped.length; i += 500) {
    const res = await fetch(PROD_INGEST, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ kind: fullSnapshot ? "holdingsSnapshot" : "holdings", rows: mapped.slice(i, i + 500) }),
    });
    const j: any = await res.json();
    if (!res.ok || !j.ok) throw new Error(`ingest failed: HTTP ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
    if (fullSnapshot) upserted += j.upserted ?? 0;
    else { accepted += j.accepted ?? 0; dupes += j.skippedDupes ?? 0; }
    batches++;
    if (fullSnapshot) {
      saveWatermark(Number(rows[Math.min(i + 499, rows.length - 1)].id));
      if (batches % 25 === 0) console.log(`[push] holdings snapshot: ${batches} batches, ${Math.min(i + 500, mapped.length)}/${mapped.length} rows, checkpoint saved`);
    }
  }
  saveWatermark(maxId);
  console.log(fullSnapshot
    ? `[push] holdings snapshot upserted: ${upserted} (${batches} batches); watermark → ${maxId}`
    : `[push] holdings ingested: ${accepted} new, ${dupes} dupes (${batches} batches); watermark → ${maxId}`);
  process.exit(0);
}

// fund_quarters is small (funds × quarters) and repaired rows may change.
// Push a full snapshot with idempotent upserts; an id watermark would hide fixes.
if (table === "fund_quarters") {
  const [rows]: any = await db.execute(sql`SELECT fundCik, quarterDate, totalValueUsd, positions, accessionNo, filingDate FROM fund_quarters ORDER BY quarterDate, fundCik`);
  console.log(`[push] fund_quarters: full snapshot of ${rows.length} rows`);
  if (rows.length === 0) { console.log("[push] nothing to do"); process.exit(0); }
  const date = (v: unknown) => typeof v === "string" ? v.slice(0, 10) : new Date(v as string).toISOString().slice(0, 10);
  const mapped = rows.map((r: any) => ({
    fundCik: Number(r.fundCik), quarterDate: date(r.quarterDate),
    totalValueUsd: r.totalValueUsd !== null ? Number(r.totalValueUsd) : null,
    positions: r.positions !== null ? Number(r.positions) : null,
    accessionNo: String(r.accessionNo), filingDate: r.filingDate ? date(r.filingDate) : null,
  }));
  if (dry) { console.log(`[push] DRY: would upsert ${mapped.length} fund_quarters; sample: ${JSON.stringify(mapped[0])}`); process.exit(0); }
  const key = process.env.WORKER_KEY;
  if (!key) throw new Error("WORKER_KEY missing");
  let upserted = 0, batches = 0;
  for (let i = 0; i < mapped.length; i += 500) {
    const res = await fetch(PROD_INGEST, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ kind: "fundQuarters", rows: mapped.slice(i, i + 500) }),
    });
    const j: any = await res.json();
    if (!res.ok || !j.ok) throw new Error(`ingest failed: HTTP ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
    upserted += j.upserted ?? 0; batches++;
  }
  console.log(`[push] fund_quarters upserted: ${upserted} (${batches} batches)`);
  process.exit(0);
}

const [rows]: any = await db.execute(
  sql`SELECT id, cik, source, signalType, eventTs, score, magnitude, payloadKey, src, note
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
