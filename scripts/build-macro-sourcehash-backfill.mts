import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { readMacroCorrectionKeys } from "./review-macro-correction.mts";

export function resolveSourceHashRow(
  localRows: { value: number | null; realtimeEnd: string | null }[],
  archiveRows: { value: number | null; supersededAt: string | null; sourceHash?: string }[],
) {
  if (!localRows.length) return { status: "missing_local" as const };
  if (localRows.length !== 1 || archiveRows.length !== 1 || !archiveRows[0].sourceHash) return { status: "missing_archive_hash" as const };
  const localEnd = localRows[0].realtimeEnd?.slice(0, 10) ?? null;
  const archiveEnd = archiveRows[0].supersededAt?.slice(0, 10) ?? null;
  if (localRows[0].value !== archiveRows[0].value || localEnd !== archiveEnd) return { status: "conflict" as const, reason: "local_vs_archive" };
  return { status: "backfill" as const, sourceHash: archiveRows[0].sourceHash };
}

async function main() {
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const keysFile = option("--keys") ?? "research/reviewed-sync/2026-11-10/macro-prod-keys.csv.gz";
const outDir = path.resolve(option("--out-dir") ?? "research/reviewed-sync/2026-11-10");
const macroRoot = path.resolve(process.platform === "win32" ? "D:/research/alpha-engine/macro" : "worker/cache/macro");
const prodKeys = readMacroCorrectionKeys(keysFile);
const seriesIds = [...new Set(prodKeys.map((key) => key.seriesId))].sort();
const archiveBySeries = new Map<string, Map<string, { value: number | null; supersededAt: string | null; sourceHash?: string }[]>>();
for (const seriesId of seriesIds) {
  const file = path.join(macroRoot, "normalized", "fred", `${seriesId}.json`);
  if (!existsSync(file)) throw new Error(`Normalized archive is missing for ${seriesId}`);
  const archive = JSON.parse(readFileSync(file, "utf8")) as any[];
  const byKey = new Map<string, any[]>();
  for (const row of archive) {
    const key = `${row.observationPeriod}|${row.availableAt?.slice(0, 10)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  archiveBySeries.set(seriesId, byKey);
}

const db = getDb();
const createdAt = new Date().toISOString();
try {
  const [localRows]: any = await db.execute(sql`SELECT seriesId, date, realtimeStart, value, realtimeEnd FROM macro_points`);
  const localByKey = new Map<string, { value: number | null; realtimeEnd: string | null }[]>();
  for (const row of localRows) {
    const key = `${row.seriesId}|${row.date}|${row.realtimeStart}`;
    localByKey.set(key, [...(localByKey.get(key) ?? []), { value: row.value, realtimeEnd: row.realtimeEnd }]);
  }
  const duplicates = [...localByKey.values()].filter((rows) => rows.length > 1).length;
  if (duplicates) throw new Error(`Local duplicate exact keys: ${duplicates}`);
  const backfillRows = [];
  const conflicts = [];
  const missingArchiveHash = [];
  let missingLocal = 0;
  for (const key of prodKeys) {
    const exactKey = `${key.seriesId}|${key.observationPeriod}|${key.realtimeStart}`;
    const resolution = resolveSourceHashRow(localByKey.get(exactKey) ?? [], archiveBySeries.get(key.seriesId)?.get(`${key.observationPeriod}|${key.realtimeStart}`) ?? []);
    if (resolution.status === "missing_local") {
      missingLocal++;
      continue;
    }
    if (resolution.status === "missing_archive_hash") {
      missingArchiveHash.push(key);
      continue;
    }
    if (resolution.status === "conflict") {
      conflicts.push({ ...key, reason: resolution.reason });
      continue;
    }
    const local = localByKey.get(exactKey)![0];
    backfillRows.push({
      seriesId: key.seriesId,
      date: key.observationPeriod,
      realtimeStart: key.realtimeStart,
      realtimeEnd: local.realtimeEnd,
      value: local.value,
      sourceHash: resolution.sourceHash,
    });
  }
  const payload = {
    schemaVersion: 1,
    createdAt,
    resultKeyDefinition: "(seriesId,date,realtimeStart)",
    rows: backfillRows.sort((a, b) => `${a.seriesId}|${a.date}|${a.realtimeStart}`.localeCompare(`${b.seriesId}|${b.date}|${b.realtimeStart}`)),
    conflicts,
    missingArchiveHash,
  };
  const file = path.join(outDir, "macro-sourcehash-backfill.json");
  const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(file, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = {
    schemaVersion: 1,
    createdAt,
    backupFile: path.basename(file),
    byteSize: bytes.length,
    sha256,
    counts: {
      prodKeysTotal: prodKeys.length,
      backfillRows: backfillRows.length,
      conflicts: conflicts.length,
      missingLocalRows: missingLocal,
      missingArchiveHash: missingArchiveHash.length,
      duplicateLocalExactKeys: duplicates,
    },
    credentialMaterialIncluded: false,
    productionApply: false,
  };
  writeFileSync(path.join(outDir, "macro-sourcehash-backfill-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ file, ...manifest }, null, 2));
} finally {
  await db.$client.end();
}
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("build-macro-sourcehash-backfill.mts")) await main();
