import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
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

async function main() {
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const keysFile = option("--keys");
const outFile = path.resolve(option("--out") ?? "worker/.runs/macro-correction-review.json");
const macroRoot = path.resolve(process.platform === "win32" ? "D:/research/alpha-engine/macro" : "worker/cache/macro");
const keys: MacroCorrectionKey[] = keysFile ? JSON.parse(readFileSync(keysFile, "utf8")).keys ?? JSON.parse(readFileSync(keysFile, "utf8")) : [];
const db = getDb();
const rows = [];
try {
  for (const key of keys) {
    const [localRows]: any = await db.execute(sql`SELECT value, realtimeEnd FROM macro_points WHERE seriesId=${key.seriesId} AND date=${key.observationPeriod} AND realtimeStart=${key.realtimeStart}`);
    const archiveFile = path.join(macroRoot, "normalized", "fred", `${key.seriesId}.json`);
    const archive = JSON.parse(readFileSync(archiveFile, "utf8")) as { observationPeriod: string; availableAt: string | null; supersededAt: string | null; value: number | null }[];
    const archiveRows = archive.filter((row) => row.observationPeriod === key.observationPeriod && row.availableAt?.slice(0, 10) === key.realtimeStart);
    rows.push({ ...key, localRows: localRows.length, archiveRows: archiveRows.length, disposition: classifyMacroCorrection(localRows, archiveRows) });
  }
  const [duplicates]: any = await db.execute(sql`SELECT seriesId, date, realtimeStart, COUNT(*) n FROM macro_points GROUP BY seriesId, date, realtimeStart HAVING COUNT(*) > 1`);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: keysFile ? "reviewed_read_only" : "keys_required_for_correction",
    localDuplicateExactKeys: duplicates.length,
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
