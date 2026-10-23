/**
 * Worker ingest service (4k, D45) — the cloud side of Variant C.
 *
 * The home worker (residential IP — GDELT/Stocktwits/Reddit/YouTube-CC are
 * datacenter-blocked, proven 2026-10-19) POSTs normalized payloads to
 * POST /api/worker/ingest. Auth: `Authorization: Bearer <key>` — we look up
 * the key's SHA-256 in worker_keys (never store the key itself; lastUsedAt
 * tracked; revokedAt kills it).
 *
 * Honesty invariants honored here:
 *  - ingestedAt is stamped SERVER-SIDE at receipt — the no-lookahead anchor
 *    never comes from the client (D43);
 *  - inserts are INSERT-IGNORE idempotent (the UQ key makes redeliveries
 *    free) and chunked ≤500 rows (the hosted-MySQL packet rule);
 *  - the payload is validated row-by-row (zod); bad rows are reported by
 *    index, not silently dropped.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { digests, signals, workerKeys } from "@db/schema";

const keyHashOf = (key: string) => createHash("sha256").update(key).digest("hex");

/** Mint a new worker key (admin-side tool): returns the PLAINTEXT key once. */
export async function mintWorkerKey(label: string): Promise<string> {
  const key = `wk_${createHash("sha256").update(`${label}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 40)}`;
  await getDb().insert(workerKeys).values({ keyHash: keyHashOf(key), label });
  return key;
}

/** Verify a Bearer key → the key's label, or null (unknown/revoked). */
export async function verifyWorkerKey(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const key = authHeader.slice(7).trim();
  if (!key) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(workerKeys)
    .where(and(eq(workerKeys.keyHash, keyHashOf(key)), isNull(workerKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  await db.update(workerKeys).set({ lastUsedAt: new Date() }).where(eq(workerKeys.id, row.id));
  return row.label;
}

/** One signals row from the worker (eventTs = content time, client-side). */
export const workerSignalRowZ = z.object({
  cik: z.number().int(),
  source: z.enum(["gdelt", "stocktwits", "reddit", "youtube", "trends", "edgar", "13f"]),
  signalType: z.enum(["tone", "buzz", "label"]),
  eventTs: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/), // datetime
  score: z.number().min(-1).max(1).nullish(),
  magnitude: z.number().nullish(),
  payloadKey: z.string().max(255).nullish(),
  src: z.enum(["live", "backfill"]).default("live"),
  /** 5c: optional one-line model rationale ("why") — human-facing, shown in the UI */
  note: z.string().max(512).nullish(),
});
export type WorkerSignalRow = z.infer<typeof workerSignalRowZ>;

/** 5e: one digest row (morning brief) from the worker. */
export const workerDigestRowZ = z.object({
  kind: z.string().max(24).default("morning"),
  scope: z.string().max(32).default(""), // ticker for company-quarter briefs
  forDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  body: z.string().min(1).max(8000),
  model: z.string().max(64).nullish(),
  meta: z.string().max(2000).nullish(), // JSON string: inputs used (row count, window)
});
export type WorkerDigestRow = z.infer<typeof workerDigestRowZ>;

export const workerIngestBodyZ = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("signals"),
    rows: z.array(workerSignalRowZ).min(1).max(500), // packet rule (D23 lineage)
  }),
  z.object({
    kind: z.literal("digests"),
    rows: z.array(workerDigestRowZ).min(1).max(10),
  }),
]);
export type WorkerIngestBody = z.infer<typeof workerIngestBodyZ>;

/**
 * Upsert digests by (kind, forDate): a redigest of the same date REFRESHES the
 * body (derived content, honest to recompute); inputs keep their own lineage.
 */
export async function ingestDigests(rows: WorkerDigestRow[]): Promise<{ upserted: number }> {
  const db = getDb();
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  let upserted = 0;
  for (const r of rows) {
    const res: any = await db.execute(sql`INSERT INTO digests (kind, scope, forDate, body, model, meta, createdAt)
      VALUES (${r.kind}, ${r.scope ?? ""}, ${r.forDate}, ${r.body}, ${r.model ?? null}, ${r.meta ?? null}, ${now})
      ON DUPLICATE KEY UPDATE body = VALUES(body), model = VALUES(model), meta = VALUES(meta), createdAt = VALUES(createdAt)`);
    upserted += Number(res[0]?.affectedRows ?? 0) > 0 ? 1 : 0;
  }
  return { upserted };
}

/**
 * Ingest a validated signals batch. Returns honest counts: accepted (newly
 * inserted) vs skippedDupes (already known via the UQ key). ingestedAt is
 * server-stamped once per batch — receipt time, never client time.
 */
export async function ingestSignals(rows: WorkerSignalRow[]): Promise<{ accepted: number; skippedDupes: number }> {
  const db = getDb();
  const ingestedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  let accepted = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res: any = await db.execute(sql`INSERT IGNORE INTO signals
      (cik, source, signalType, eventTs, ingestedAt, score, magnitude, payloadKey, src, note)
      VALUES ${sql.join(
        rows.slice(i, i + CHUNK).map(
          (r) =>
            sql`(${r.cik}, ${r.source}, ${r.signalType}, ${r.eventTs.replace("T", " ")}, ${ingestedAt}, ${r.score ?? null}, ${r.magnitude ?? null}, ${r.payloadKey ?? null}, ${r.src}, ${r.note ?? null})`
        ),
        sql`, `
      )}`);
    accepted += Number(res[0]?.affectedRows ?? 0);
  }
  return { accepted, skippedDupes: rows.length - accepted };
}
