import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { macroPoints, prices, reports } from "@db/schema";
import { reportFilePolicy } from "@contracts/report-files";
import { getDb } from "../queries/connection";

const day = (message: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, message);
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), "ISO timestamp required");
const hash = z.string().regex(/^[a-f0-9]{64}$/);

/** mysql2 can return DATE/TIMESTAMP as Date objects and BIGINT as strings while
 * the wire sends strings and numbers. Canonicalize both sides before comparison —
 * raw driver values otherwise fail post-checks on real rows (simplified mocks hid this). */
const canonicalDay = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};
const canonicalTs = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(String(value));
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString();
};

export const workerPriceDailyRowZ = z.object({
  cik: z.number().int().nonnegative(),
  ticker: z.string().min(1).max(20),
  date: day("YYYY-MM-DD date required"),
  open: z.number().finite().nonnegative(),
  high: z.number().finite().nonnegative(),
  low: z.number().finite().nonnegative(),
  close: z.number().finite().nonnegative(),
  adjClose: z.number().finite().nonnegative().nullish(),
  volume: z.number().int().nonnegative(),
  source: z.enum(["schwab", "stooq"]),
  fetchedAt: timestamp,
}).superRefine((row, context) => {
  if (row.low > row.open || row.low > row.close || row.open > row.high || row.close > row.high || row.low > row.high) {
    context.addIssue({ code: "custom", message: "OHLC sanity requires low<=open/close<=high" });
  }
});
export type WorkerPriceDailyRow = z.infer<typeof workerPriceDailyRowZ>;

export const workerMacroPointRowZ = z.object({
  seriesId: z.string().min(1).max(32),
  observationPeriod: day("YYYY-MM-DD observationPeriod required"),
  realtimeStart: day("YYYY-MM-DD realtimeStart required"),
  realtimeEnd: day("YYYY-MM-DD realtimeEnd required").nullable(),
  value: z.number().finite().nullable(),
  sourceHash: hash,
}).superRefine((row, context) => {
  if (row.realtimeEnd && row.realtimeStart > row.realtimeEnd) context.addIssue({ code: "custom", message: "realtimeStart must not exceed realtimeEnd" });
});
export type WorkerMacroPointRow = z.infer<typeof workerMacroPointRowZ>;

export const workerOperationalIngestOptions = [
  z.object({ kind: z.literal("pricesDaily"), rows: z.array(workerPriceDailyRowZ).min(1).max(500) }),
  z.object({ kind: z.literal("macroPoints"), rows: z.array(workerMacroPointRowZ).min(1).max(500) }),
  z.object({
    kind: z.literal("reportFile"),
    name: z.string().min(1).max(128),
    body: z.string().min(1).max(40 * 1024 * 1024),
    sha256: hash,
    generatedAt: timestamp,
    contentEncoding: z.literal("gzip-base64").optional(),
  }),
];

function assertPriceDateNotFuture(row: WorkerPriceDailyRow, now: Date) {
  const today = now.toISOString().slice(0, 10);
  if (row.date > today) throw new Error(`Future price date is forbidden: ${row.date}`);
}

function priceKey(row: Pick<WorkerPriceDailyRow, "cik" | "date" | "source">) {
  return `${row.cik}|${canonicalDay(row.date)}|${row.source}`;
}

function priceContent(row: any) {
  return [row.ticker, row.open, row.high, row.low, row.close, row.adjClose ?? null, row.volume === null || row.volume === undefined ? null : Number(row.volume), row.source, canonicalTs(row.fetchedAt)];
}

export async function ingestPricesDaily(rows: WorkerPriceDailyRow[], options: { db?: any; now?: Date } = {}) {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  for (const row of rows) assertPriceDateNotFuture(row, now);
  const unique = new Map<string, WorkerPriceDailyRow>();
  let duplicateInputs = 0;
  for (const row of rows) {
    const key = priceKey(row);
    const prior = unique.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw new Error(`Conflicting pricesDaily exact key: ${key}`);
    if (prior) duplicateInputs++;
    unique.set(key, row);
  }
  let accepted = 0;
  let dupes = duplicateInputs;
  for (const cik of new Set([...unique.values()].map((row) => row.cik))) {
    const batch = [...unique.values()].filter((row) => row.cik === cik);
    const existing = await db.select().from(prices).where(eq(prices.cik, cik));
    const existingByKey = new Map(existing.map((row: any) => [priceKey(row), row]));
    for (const row of batch) {
      const current: any = existingByKey.get(priceKey(row));
      if (current && JSON.stringify(priceContent(current)) === JSON.stringify(priceContent(row))) dupes++;
      else accepted++;
    }
    for (let offset = 0; offset < batch.length; offset += 500) {
      const slice = batch.slice(offset, offset + 500).map((row) => ({ ...row, fetchedAt: new Date(row.fetchedAt) }));
      await db.insert(prices).values(slice).onDuplicateKeyUpdate({
        set: {
          ticker: sql`VALUES(\`ticker\`)`, open: sql`VALUES(\`open\`)`, high: sql`VALUES(\`high\`)`, low: sql`VALUES(\`low\`)`,
          close: sql`VALUES(\`close\`)`, adjClose: sql`VALUES(\`adjClose\`)`, volume: sql`VALUES(\`volume\`)`, fetchedAt: sql`VALUES(\`fetchedAt\`)`,
        },
      });
    }
  }
  let verified = 0;
  for (const cik of new Set([...unique.values()].map((row) => row.cik))) {
    const persisted = await db.select().from(prices).where(eq(prices.cik, cik));
    const byKey = new Map(persisted.map((row: any) => [priceKey(row), row]));
    for (const row of [...unique.values()].filter((item) => item.cik === cik)) {
      const current: any = byKey.get(priceKey(row));
      if (current && JSON.stringify(priceContent(current)) === JSON.stringify(priceContent(row))) verified++;
    }
  }
  if (verified !== unique.size) throw new Error(`pricesDaily post-check mismatch: ${verified}/${unique.size}`);
  return { accepted, dupes, postCheck: { expected: unique.size, verified, failed: unique.size - verified } };
}

function macroKey(row: Pick<WorkerMacroPointRow, "seriesId" | "observationPeriod" | "realtimeStart">) {
  return `${row.seriesId}|${canonicalDay(row.observationPeriod)}|${canonicalDay(row.realtimeStart)}`;
}

export async function ingestMacroPoints(rows: WorkerMacroPointRow[], options: { db?: any; now?: Date } = {}) {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const unique = new Map<string, WorkerMacroPointRow>();
  const rejected: { key: string; reason: string }[] = [];
  for (const row of rows) {
    const key = macroKey(row);
    const prior = unique.get(key);
    if (prior && (prior.value !== row.value || prior.realtimeEnd !== row.realtimeEnd || prior.sourceHash !== row.sourceHash)) {
      rejected.push({ key, reason: "conflicting rows for one vintage exact key" });
      continue;
    }
    unique.set(key, row);
  }
  let accepted = 0;
  let dupes = 0;
  for (const seriesId of new Set([...unique.values()].map((row) => row.seriesId))) {
    const batch = [...unique.values()].filter((row) => row.seriesId === seriesId);
    const existing = await db.select().from(macroPoints).where(eq(macroPoints.seriesId, seriesId));
    const candidates = batch.filter((row) => {
      const same = existing.filter((item: any) => macroKey({ seriesId, observationPeriod: item.date, realtimeStart: item.realtimeStart }) === macroKey(row));
      for (const current of same) {
        if (current.value !== row.value || canonicalDay(current.realtimeEnd) !== canonicalDay(row.realtimeEnd) || (current.sourceHash && current.sourceHash !== row.sourceHash)) {
          rejected.push({ key: macroKey(row), reason: "existing vintage content differs; overwrite refused" });
          return false;
        }
      }
      const olderOverlap = existing.some((current: any) => canonicalDay(current.date) === canonicalDay(row.observationPeriod) && canonicalDay(current.realtimeStart)! > canonicalDay(row.realtimeStart)! && (row.realtimeEnd === null || canonicalDay(row.realtimeEnd)! > canonicalDay(current.realtimeStart)!));
      if (olderOverlap) {
        rejected.push({ key: macroKey(row), reason: "older open vintage overlaps a newer realtimeStart" });
        return false;
      }
      return true;
    });
    const allowedCandidates: WorkerMacroPointRow[] = [];
    for (const row of [...candidates].sort((a, b) => b.realtimeStart.localeCompare(a.realtimeStart))) {
      const overlap = allowedCandidates.some((current) => canonicalDay(current.observationPeriod) === canonicalDay(row.observationPeriod) && canonicalDay(current.realtimeStart)! > canonicalDay(row.realtimeStart)! && (row.realtimeEnd === null || canonicalDay(row.realtimeEnd)! > canonicalDay(current.realtimeStart)!));
      if (overlap) rejected.push({ key: macroKey(row), reason: "older open vintage overlaps a newer batch realtimeStart" });
      else allowedCandidates.push(row);
    }
    const acceptedForSeries = allowedCandidates.filter((row) => !existing.some((current: any) => macroKey({ seriesId, observationPeriod: current.date, realtimeStart: current.realtimeStart }) === macroKey(row))).length;
    accepted += acceptedForSeries;
    dupes += allowedCandidates.length - acceptedForSeries;
    for (let offset = 0; offset < allowedCandidates.length; offset += 500) {
      const slice = allowedCandidates.slice(offset, offset + 500).map((row) => ({
        seriesId: row.seriesId,
        date: row.observationPeriod,
        value: row.value,
        realtimeStart: row.realtimeStart,
        realtimeEnd: row.realtimeEnd,
        sourceHash: row.sourceHash,
        fetchedAt: now,
      }));
      await db.insert(macroPoints).values(slice).onDuplicateKeyUpdate({ set: { sourceHash: sql`VALUES(\`sourceHash\`)`, fetchedAt: sql`VALUES(\`fetchedAt\`)` } });
    }
  }
  let verified = 0;
  const rejectedKeys = new Set(rejected.map((row) => row.key));
  const expected = [...unique.values()].filter((row) => !rejectedKeys.has(macroKey(row)));
  for (const seriesId of new Set(expected.map((row) => row.seriesId))) {
    const persisted = await db.select().from(macroPoints).where(eq(macroPoints.seriesId, seriesId));
    for (const row of expected.filter((item) => item.seriesId === seriesId)) {
      if (persisted.some((current: any) => canonicalDay(current.date) === canonicalDay(row.observationPeriod) && canonicalDay(current.realtimeStart) === canonicalDay(row.realtimeStart) && current.value === row.value && canonicalDay(current.realtimeEnd) === canonicalDay(row.realtimeEnd) && current.sourceHash === row.sourceHash)) verified++;
    }
  }
  if (verified !== expected.length) throw new Error(`macroPoints post-check mismatch: ${verified}/${expected.length}`);
  return { accepted, dupes, rejected, postCheck: { expected: expected.length, verified, failed: expected.length - verified } };
}

export async function ingestReportFile(input: { name: string; body: string; sha256: string; generatedAt: string; contentEncoding?: "gzip-base64" }, options: { db?: any; now?: Date } = {}) {
  reportFilePolicy(input.name);
  if (input.contentEncoding) {
    if (input.name !== "insider-form4.json" || !input.body.startsWith("gzip-base64:")) throw new Error("Unsupported report content encoding");
    const plain = gunzipSync(Buffer.from(input.body.slice("gzip-base64:".length), "base64"), { maxOutputLength: 256 * 1024 * 1024 }).toString("utf8");
    const parsed = JSON.parse(plain);
    if (parsed.status !== "full_run" || parsed.universe !== 50 || !parsed.kpi || !Array.isArray(parsed.perTicker)
      || parsed.transactions?.length !== Math.min(500, parsed.totals?.transactions) || parsed.clusters?.length !== parsed.totals?.clusters
      || !Array.isArray(parsed.benchmarkRuns) || parsed.benchmarkRuns.length !== 2) {
      throw new Error("Compressed Form 4 report is not a complete full-run artifact");
    }
  }
  const actualHash = createHash("sha256").update(input.body).digest("hex");
  if (actualHash !== input.sha256) throw new Error("reportFile body SHA256 mismatch");
  const generatedAt = new Date(input.generatedAt);
  if (!Number.isFinite(generatedAt.getTime())) throw new Error("reportFile generatedAt is invalid");
  const db = options.db ?? getDb();
  const [existing] = await db.select().from(reports).where(eq(reports.name, input.name)).limit(1);
  if (existing && canonicalTs(existing.generatedAt) >= canonicalTs(generatedAt)) {
    return { accepted: 0, dupes: 1, postCheck: { expected: 1, verified: existing.sha256 === input.sha256 ? 1 : 0, failed: existing.sha256 === input.sha256 ? 0 : 1 } };
  }
  const now = options.now ?? new Date();
  await db.insert(reports).values({ name: input.name, body: input.body, sha256: input.sha256, generatedAt, updatedAt: now }).onDuplicateKeyUpdate({
    set: { body: sql`VALUES(\`body\`)`, sha256: sql`VALUES(\`sha256\`)`, generatedAt: sql`VALUES(\`generatedAt\`)`, updatedAt: sql`VALUES(\`updatedAt\`)` },
  });
  const [persisted] = await db.select().from(reports).where(eq(reports.name, input.name)).limit(1);
  const verified = persisted && persisted.body === input.body && persisted.sha256 === input.sha256 && canonicalTs(persisted.generatedAt) === canonicalTs(generatedAt) ? 1 : 0;
  if (!verified) throw new Error("reportFile post-check mismatch");
  return { accepted: 1, dupes: 0, postCheck: { expected: 1, verified, failed: 0 } };
}

export async function existingReport(name: string, db: any = getDb()) {
  const [row] = await db.select().from(reports).where(eq(reports.name, name)).limit(1);
  return row;
}
