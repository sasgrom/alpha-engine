/** Restore legacy macro_points from the normalized official FRED/ALFRED archive.
 * Default is a read-only dry-run. --apply requires a verified complete-table backup. */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { asc } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { ingestMacroPoints } from "../api/services/macro";
import { macroPoints } from "@db/schema";
import { backfillMacroVintageSeries, CURATED_MACRO_SERIES, MacroVintageConflictError, prepareMacroVintageBackfill, type MacroVintageBackfillPlan, type NormalizedMacroVintageRow } from "../worker/lib/macro-vintage-backfill";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const apply = process.argv.includes("--apply");
const macroRoot = path.resolve(arg("--macro-root") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\macro" : "worker/cache/macro"));
const requestedSeries = arg("--series")?.toUpperCase();
const seriesIds = requestedSeries ? [requestedSeries] : [...CURATED_MACRO_SERIES];
for (const seriesId of seriesIds) if (!CURATED_MACRO_SERIES.includes(seriesId as (typeof CURATED_MACRO_SERIES)[number])) throw new Error(`Unsupported curated series ${seriesId}`);
const outDir = path.resolve(arg("--out") ?? `worker/.runs/macro-vintage-backfill-${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`);
const resultPath = path.join(outDir, "backfill-result.json");
if (existsSync(resultPath)) throw new Error(`Refusing to overwrite an existing backfill result: ${resultPath}`);
const backupManifestPath = arg("--backup-manifest") ? path.resolve(arg("--backup-manifest")!) : null;
if (apply && !backupManifestPath) throw new Error("--apply requires --backup-manifest from a complete macro_points backup");
mkdirSync(outDir, { recursive: true });
const db = getDb();
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fingerprint = (rows: unknown) => JSON.stringify(rows);
const writeResult = (result: unknown) => {
  const text = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(resultPath, text);
  const parsed = JSON.parse(readFileSync(resultPath, "utf8"));
  if (sha256(readFileSync(resultPath)) !== sha256(text) || !parsed.processCompleted) throw new Error("Backfill result validation failed");
  console.log(JSON.stringify({ result: resultPath, status: parsed.status, apply, plannedRows: parsed.totals?.plannedRows ?? 0, insertedRows: parsed.totals?.insertedRows ?? 0, errors: parsed.totals?.errors ?? 1 }, null, 2));
};
let exitCode = 0;
try {
  const currentRows = await db.select().from(macroPoints).orderBy(asc(macroPoints.id));
  let backup: { path: string; sha256: string; rows: number } | null = null;
  if (apply) {
    const manifest = JSON.parse(readFileSync(backupManifestPath!, "utf8"));
    if (manifest.beforeAnyDbWrite !== true || manifest.table !== "macro_points" || manifest.scope !== "complete table ordered by id") throw new Error("Backup is not a complete pre-write macro_points backup");
    const backupPath = path.resolve(path.dirname(backupManifestPath!), manifest.path ? path.basename(manifest.path) : "backup-macro-points.json");
    const backupText = readFileSync(backupPath, "utf8");
    if (sha256(backupText) !== manifest.sha256 || Buffer.byteLength(backupText) !== manifest.bytes) throw new Error("Backup SHA256 or size mismatch");
    const backupRows = JSON.parse(backupText);
    if (backupRows.length !== manifest.rows || fingerprint(backupRows) !== fingerprint(currentRows)) throw new Error("Current macro_points differs from the reviewed backup; refusing stale apply");
    backup = { path: backupPath, sha256: manifest.sha256, rows: backupRows.length };
  }

  const manifestPath = path.join(macroRoot, "manifest-fred.json");
  if (!existsSync(manifestPath)) throw new Error(`FRED manifest missing: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const ready: { plan: MacroVintageBackfillPlan; source: unknown }[] = [];
  const results: unknown[] = [];
  for (const seriesId of seriesIds) {
    const normalizedPath = path.join(macroRoot, "normalized", "fred", `${seriesId}.json`);
    try {
      if (!existsSync(normalizedPath)) throw new Error(`Normalized archive missing for ${seriesId}: ${normalizedPath}`);
      const entry = manifest.entries?.find((item: any) => item.seriesId === seriesId);
      if (!entry || entry.status !== "complete") throw new Error(`Complete manifest entry missing for ${seriesId}`);
      const rawPath = entry.raw?.observations?.file;
      if (!rawPath || !existsSync(rawPath) || sha256(readFileSync(rawPath)) !== entry.raw.observations.sha256) throw new Error(`Raw source hash mismatch for ${seriesId}`);
      const normalizedText = readFileSync(normalizedPath, "utf8");
      const archiveRows = JSON.parse(normalizedText) as NormalizedMacroVintageRow[];
      if (archiveRows.length !== entry.rows) throw new Error(`Archive row-count mismatch for ${seriesId}`);
      const sourceHashes = [...new Set(archiveRows.map((row) => row.sourceHash))];
      if (sourceHashes.length !== 1 || sourceHashes[0] !== entry.raw.observations.sha256) throw new Error(`Normalized source hash mismatch for ${seriesId}`);
      const fetchedAt = new Date().toISOString();
      const plan = prepareMacroVintageBackfill(seriesId, archiveRows, currentRows.filter((row) => row.seriesId === seriesId), fetchedAt);
      const source = { normalizedPath, normalizedSha256: sha256(normalizedText), normalizedRows: archiveRows.length, rawObservationPath: rawPath, rawObservationSha256: entry.raw.observations.sha256, manifestCapturedAt: entry.capturedAt, availabilityMode: entry.availabilityMode ?? null };
      ready.push({ plan, source });
      results.push({ seriesId, status: "planned", plannedRows: plan.points.length, unchangedExistingRows: plan.unchangedExistingRows, duplicateArchiveRows: plan.duplicateArchiveRows, missingAvailability: plan.missingAvailability, source });
    } catch (error) {
      results.push({
        seriesId,
        status: "error",
        code: error instanceof MacroVintageConflictError ? "vintage_conflict" : "source_or_mapping_error",
        message: error instanceof Error ? error.message.slice(0, 1000) : "unknown error",
        ...(error instanceof MacroVintageConflictError ? { conflicts: error.conflicts } : {}),
      });
    }
  }

  // Conflict-bearing series are wholly preserved; independent valid series remain explicitly partial.
  let insertedRows = 0;
  if (apply) {
    for (const { plan, source } of ready) {
      const applied = await backfillMacroVintageSeries(plan, ingestMacroPoints);
      insertedRows += applied.insertedRows;
      const index = results.findIndex((result: any) => result.seriesId === plan.seriesId);
      results[index] = { ...applied, plannedRows: plan.points.length, missingAvailabilityRows: plan.missingAvailability, source };
    }
  }
  const errorCount = results.filter((result: any) => result.status === "error").length;
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    processCompleted: true,
    mode: apply ? "apply" : "dry-run",
    status: errorCount ? "partial" : "complete",
    macroRoot,
    seriesIds,
    backup,
    backupFingerprintVerified: apply,
    deletes: 0,
    maxInsertBatch: 500,
    results,
    totals: {
      plannedRows: ready.reduce((sum, item) => sum + item.plan.points.length, 0),
      insertedRows,
      unchangedExistingRows: ready.reduce((sum, item) => sum + item.plan.unchangedExistingRows, 0),
      duplicateArchiveRows: ready.reduce((sum, item) => sum + item.plan.duplicateArchiveRows, 0),
      missingAvailability: ready.reduce((sum, item) => sum + item.plan.missingAvailability.length, 0),
      conflicts: results.reduce((sum: number, result: any) => sum + (result.conflicts?.length ?? 0), 0),
      errors: errorCount,
    },
    remainingBlockers: results.filter((result: any) => result.status === "error"),
    noRetry: true,
  };
  writeResult(result);
  if (errorCount) exitCode = 1;
} catch (error) {
  writeResult({ schemaVersion: 1, generatedAt: new Date().toISOString(), processCompleted: true, mode: apply ? "apply" : "dry-run", status: "error", macroRoot, seriesIds, message: error instanceof Error ? error.message.slice(0, 1000) : "unknown error", noRetry: true });
  exitCode = 1;
} finally {
  await db.$client.end();
}
process.exitCode = exitCode;
