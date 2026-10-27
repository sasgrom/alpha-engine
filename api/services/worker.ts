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
import { digests, facts, signals, workerKeys } from "@db/schema";

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
  signalType: z.enum(["tone", "buzz", "label", "position"]),
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

/** 5g: one 13F holding row (positions go through ingest like signals do). */
export const workerHoldingRowZ = z.object({
  fundCik: z.number().int(),
  fundName: z.string().max(128),
  cusip: z.string().max(12),
  secClass: z.string().max(12).default("COM"),
  heldCik: z.number().int().nullish(),
  issuer: z.string().max(255).nullish(),
  shares: z.number().nullish(),
  valueUsd: z.number().nullish(),
  quarterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accessionNo: z.string().max(25),
  tier: z.string().max(16).nullish(),
});
export type WorkerHoldingRow = z.infer<typeof workerHoldingRowZ>;

/** One complete 13F book summary per fund-quarter, including availability. */
export const workerQuarterRowZ = z.object({
  fundCik: z.number().int(),
  quarterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalValueUsd: z.number().nonnegative().nullish(),
  positions: z.number().int().nonnegative().nullish(),
  accessionNo: z.string().max(25),
  filingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
export type WorkerQuarterRow = z.infer<typeof workerQuarterRowZ>;

const factDateZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();
export const workerFactRowZ = z.object({
  cik: z.number().int(),
  taxonomy: z.string().min(1).max(20),
  concept: z.string().min(1).max(200),
  unit: z.string().min(1).max(40),
  startDate: factDateZ,
  endDate: factDateZ,
  val: z.number().nullish(),
  fy: z.number().int().nullish(),
  fp: z.string().max(8).nullish(),
  form: z.string().max(12).nullish(),
  filed: factDateZ,
  accn: z.string().max(25).nullish(),
});
export type WorkerFactRow = z.infer<typeof workerFactRowZ>;

export const workerIngestBodyZ = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("signals"),
    rows: z.array(workerSignalRowZ).min(1).max(500), // packet rule (D23 lineage)
  }),
  z.object({
    kind: z.literal("digests"),
    rows: z.array(workerDigestRowZ).min(1).max(10),
  }),
  z.object({
    kind: z.literal("holdings"),
    rows: z.array(workerHoldingRowZ).min(1).max(500),
  }),
  z.object({
    kind: z.literal("holdingsSnapshot"),
    rows: z.array(workerHoldingRowZ).min(1).max(500),
  }),
  z.object({
    kind: z.literal("fundQuarters"),
    rows: z.array(workerQuarterRowZ).min(1).max(500),
  }),
  z.object({
    kind: z.literal("factsSnapshot"),
    cik: z.number().int(),
    rows: z.array(workerFactRowZ).min(1).max(100_000),
  }),
]);

/** Upsert-free insert (INSERT IGNORE on the uq) — redeliveries are free. */
export async function ingestHoldings(rows: WorkerHoldingRow[]): Promise<{ accepted: number; skippedDupes: number }> {
  const db = getDb();
  let accepted = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res: any = await db.execute(sql`INSERT IGNORE INTO fund_holdings
      (fundCik, fundName, cusip, secClass, heldCik, issuer, shares, valueUsd, quarterDate, accessionNo, tier)
      VALUES ${sql.join(
        rows.slice(i, i + CHUNK).map(
          (r) =>
            sql`(${r.fundCik}, ${r.fundName}, ${r.cusip}, ${r.secClass}, ${r.heldCik ?? null}, ${r.issuer ?? null}, ${r.shares ?? null}, ${r.valueUsd ?? null}, ${r.quarterDate}, ${r.accessionNo}, ${r.tier ?? null})`
        ),
        sql`, `
      )}`);
    accepted += Number(res[0]?.affectedRows ?? 0);
  }
  return { accepted, skippedDupes: rows.length - accepted };
}

/** Full-repair snapshot: updates changed holdings without deleting prod rows. */
export async function ingestHoldingsSnapshot(rows: WorkerHoldingRow[]): Promise<{ upserted: number }> {
  const db = getDb();
  let upserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db.execute(sql`INSERT INTO fund_holdings
      (fundCik, fundName, cusip, secClass, heldCik, issuer, shares, valueUsd, quarterDate, accessionNo, tier)
      VALUES ${sql.join(chunk.map((r) => sql`(${r.fundCik}, ${r.fundName}, ${r.cusip}, ${r.secClass}, ${r.heldCik ?? null}, ${r.issuer ?? null}, ${r.shares ?? null}, ${r.valueUsd ?? null}, ${r.quarterDate}, ${r.accessionNo}, ${r.tier ?? null})`), sql`, `)}
      ON DUPLICATE KEY UPDATE fundName=VALUES(fundName), heldCik=VALUES(heldCik), issuer=VALUES(issuer), shares=VALUES(shares), valueUsd=VALUES(valueUsd), accessionNo=VALUES(accessionNo), tier=VALUES(tier)`);
    upserted += chunk.length;
  }
  return { upserted };
}

/** Full-snapshot upsert: repaired books may change existing quarter rows. */
export async function ingestFundQuarters(rows: WorkerQuarterRow[]): Promise<{ upserted: number }> {
  const db = getDb();
  let upserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db.execute(sql`INSERT INTO fund_quarters
      (fundCik, quarterDate, totalValueUsd, positions, accessionNo, filingDate)
      VALUES ${sql.join(chunk.map((r) => sql`(${r.fundCik}, ${r.quarterDate}, ${r.totalValueUsd ?? null}, ${r.positions ?? null}, ${r.accessionNo}, ${r.filingDate ?? null})`), sql`, `)}
      ON DUPLICATE KEY UPDATE totalValueUsd=VALUES(totalValueUsd), positions=VALUES(positions), accessionNo=VALUES(accessionNo), filingDate=VALUES(filingDate)`);
    upserted += chunk.length;
  }
  return { upserted };
}

/** Full companyfacts replacement for one CIK. Validation happens before the
 * transaction; any insert failure rolls back both the delete and all chunks. */
export async function ingestFactsSnapshot(cik: number, rows: WorkerFactRow[]): Promise<{ replaced: number }> {
  if (rows.some((r) => r.cik !== cik)) throw new Error("factsSnapshot contains a mismatched CIK");
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(facts).where(eq(facts.cik, cik));
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(facts).values(rows.slice(i, i + 500));
    }
  });
  return { replaced: rows.length };
}

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
