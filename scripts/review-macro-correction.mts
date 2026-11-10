import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

export interface MacroCorrectionKey { seriesId: string; observationPeriod: string; realtimeStart: string }
export type MacroCorrectionDisposition = "delete_candidate_local_missing" | "keep_local_row" | "review_archive_mismatch" | "review_local_mismatch";

export function classifyMacroCorrection(localRows: { value: number | null; realtimeEnd: string | null }[], archiveRows: { value: number | null; supersededAt: string | null }[]): MacroCorrectionDisposition {
  if (!localRows.length) return "delete_candidate_local_missing";
  if (!archiveRows.length) return "review_local_mismatch";
  if (localRows.length !== 1 || archiveRows.length !== 1) return "review_archive_mismatch";
  return localRows[0].value === archiveRows[0].value && localRows[0].realtimeEnd === archiveRows[0].supersededAt ? "keep_local_row" : "review_archive_mismatch";
}

export function readMacroCorrectionKeys(file: string): (MacroCorrectionKey & { prodRealtimeEnd: string | null; prodValue: number | null; prodSourceHash: string | null })[] {
  if (/\.csv\.gz$/i.test(file)) {
    const lines = gunzipSync(readFileSync(file)).toString("utf8").trim().split(/\r?\n/);
    return lines.slice(1).filter(Boolean).map((line) => {
      const [seriesId, observationPeriod, realtimeStart, realtimeEnd, rawValue, sourceHash] = line.split(",");
      return {
        seriesId,
        observationPeriod,
        realtimeStart,
        prodRealtimeEnd: realtimeEnd || null,
        prodValue: rawValue ? Number(rawValue) : null,
        prodSourceHash: sourceHash || null,
      };
    });
  }
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const rows = parsed.keys ?? parsed;
  return rows.map((row: any) => ({ ...row, prodRealtimeEnd: row.prodRealtimeEnd ?? null, prodValue: row.prodValue ?? null, prodSourceHash: row.prodSourceHash ?? null }));
}

async function main() {
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const keysFile = option("--keys");
const outFile = path.resolve(option("--out") ?? "worker/.runs/macro-correction-review.json");
const macroRoot = path.resolve(process.platform === "win32" ? "D:/research/alpha-engine/macro" : "worker/cache/macro");
const prodKeys = keysFile ? readMacroCorrectionKeys(keysFile) : [];
const db = getDb();
const rows = [];
try {
  let localKeySet = new Set<string>();
  if (keysFile) {
    const [localKeys]: any = await db.execute(sql`SELECT seriesId, date, realtimeStart FROM macro_points`);
    localKeySet = new Set(localKeys.map((row: any) => `${row.seriesId}|${row.date}|${row.realtimeStart}`));
  }
  const keys = prodKeys.filter((key) => !localKeySet.has(`${key.seriesId}|${key.observationPeriod}|${key.realtimeStart}`));
  const localByKey = new Map<string, { value: number | null; realtimeEnd: string | null }[]>();
  console.error(`[macro-correction] prodKeys=${prodKeys.length} · localKeys=${localKeySet.size} · candidates=${keys.length} · grouped select start`);
  if (keys.length) {
    const tuples = keys.map(() => "(?, ?, ?)").join(", ");
    const params = keys.flatMap((key) => [key.seriesId, key.observationPeriod, key.realtimeStart]);
    const [localRows]: any = await db.$client.promise().query(`SELECT seriesId, date, realtimeStart, value, realtimeEnd FROM macro_points WHERE (seriesId, date, realtimeStart) IN (${tuples})`, params);
    for (const row of localRows) {
      const key = `${row.seriesId}|${row.date}|${row.realtimeStart}`;
      localByKey.set(key, [...(localByKey.get(key) ?? []), { value: row.value, realtimeEnd: row.realtimeEnd }]);
    }
  }
  console.error(`[macro-correction] grouped select done · keys=${localByKey.size}`);
  for (const key of keys) {
    const localRows = localByKey.get(`${key.seriesId}|${key.observationPeriod}|${key.realtimeStart}`) ?? [];
    const archiveFile = path.join(macroRoot, "normalized", "fred", `${key.seriesId}.json`);
    const archive = JSON.parse(readFileSync(archiveFile, "utf8")) as { observationPeriod: string; availableAt: string | null; supersededAt: string | null; value: number | null }[];
    const archiveRows = archive.filter((row) => row.observationPeriod === key.observationPeriod && row.availableAt?.slice(0, 10) === key.realtimeStart);
    rows.push({ ...key, localRows: localRows.length, archiveRows: archiveRows.length, disposition: classifyMacroCorrection(localRows, archiveRows) });
  }
  console.error("[macro-correction] archive classification done · duplicate select start");
  const [duplicates]: any = await db.execute(sql`SELECT seriesId, date, realtimeStart, COUNT(*) n FROM macro_points GROUP BY seriesId, date, realtimeStart HAVING COUNT(*) > 1`);
  console.error("[macro-correction] duplicate select done");
  const byDisposition: Record<string, number> = {};
  for (const row of rows) byDisposition[row.disposition] = (byDisposition[row.disposition] ?? 0) + 1;
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: keysFile ? "reviewed_read_only" : "keys_required_for_correction",
    prodKeysTotal: prodKeys.length,
    localKeysTotal: localKeySet.size,
    localDuplicateExactKeys: duplicates.length,
    candidates: rows.length,
    byDisposition,
    corrections: rows,
    productionApply: false,
  };
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.$client.end();
}
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("review-macro-correction.mts")) await main();
