/**
 * 4k QA (D45): the worker ingest path against the live DB — mint a QA key,
 * verify auth (bad key rejected), ingest a synthetic batch, prove
 * idempotency (redelivery = all dupes), clean up every row. Revokes the QA
 * key at the end. Run: npx tsx t_4k_worker.mts
 */
import { getDb } from "./api/queries/connection";
import { signals, workerKeys } from "@db/schema";
import { and, eq, sql } from "drizzle-orm";
import { mintWorkerKey, verifyWorkerKey, ingestSignals, workerIngestBodyZ } from "./api/services/worker";

const db = getDb();
const fail = (m: string): never => {
  console.error("FAIL:", m);
  process.exit(1);
};

// --- key lifecycle -----------------------------------------------------------
const key = await mintWorkerKey("qa-4k");
if (!(await verifyWorkerKey(`Bearer ${key}`))) fail("fresh key did not verify");
if (await verifyWorkerKey("Bearer wk_garbage")) fail("garbage key accepted!");
if (await verifyWorkerKey(null)) fail("missing header accepted!");
console.log("key lifecycle ok");

// --- payload validation ------------------------------------------------------
const bad = workerIngestBodyZ.safeParse({ kind: "signals", rows: [{ cik: 1, source: "gdelt", signalType: "tone", eventTs: "not-a-date" }] });
if (bad.success) fail("bad eventTs accepted");
const tooMany = workerIngestBodyZ.safeParse({ kind: "signals", rows: Array(501).fill(null) });
if (tooMany.success) fail("501 rows accepted (packet rule)");
console.log("validation ok");

// --- ingest + idempotency ------------------------------------------------------
// unique per run — a previous crashed run must not poison this one
const tagTs = new Date().toISOString().slice(0, 19).replace("T", " ");
const row = {
  cik: 320193,
  source: "gdelt" as const,
  signalType: "tone" as const,
  eventTs: tagTs,
  score: 0.42,
  magnitude: 1,
  src: "live" as const,
};
const r1 = await ingestSignals([row]);
if (r1.accepted !== 1 || r1.skippedDupes !== 0) fail(`first ingest wrong: ${JSON.stringify(r1)}`);
const r2 = await ingestSignals([row]);
if (r2.accepted !== 0 || r2.skippedDupes !== 1) fail(`redelivery not deduped: ${JSON.stringify(r2)}`);
// ingestedAt is server-stamped (a client-supplied one would defeat no-lookahead)
const [rows]: any = await db.execute(
  sql`SELECT COUNT(*) n FROM signals WHERE cik=320193 AND source='gdelt' AND eventTs=${tagTs} AND ingestedAt IS NOT NULL`
);
if (Number(rows[0]?.n ?? 0) !== 1) fail("ingested row missing or ingestedAt not stamped");
console.log("ingest + idempotency + server-stamped ingestedAt ok");

// --- cleanup ------------------------------------------------------------------
await db.execute(sql`DELETE FROM signals WHERE cik=320193 AND source='gdelt' AND eventTs=${tagTs}`);
await db.execute(sql`UPDATE worker_keys SET revokedAt=NOW() WHERE label='qa-4k'`);
if (await verifyWorkerKey(`Bearer ${key}`)) fail("revoked key still verifies");
await db.delete(workerKeys).where(eq(workerKeys.label, "qa-4k"));
console.log("cleanup + revocation ok");

console.log("PASS: 4k worker ingest (auth, validation, idempotency, server-side ingestedAt, revocation)");
process.exit(0);
