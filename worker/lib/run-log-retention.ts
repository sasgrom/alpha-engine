/** Retention for the scheduler's per-run log files in worker/.runs: files older than the limit are removed. */
import { readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

/** `<epoch ms>-<job id>.log`, the name the scheduler gives each run. Nothing else in the folder is ever touched. */
export const RUN_LOG_NAME = /^\d{13}-[a-z0-9][a-z0-9-]*\.log$/;

export interface RunLogRetentionResult { scanned: number; removed: number; kept: number; failed: number; bytesRemoved: number; cutoff: string }

export function pruneRunLogs(params: { dir: string; days: number; nowMs?: number; dryRun?: boolean }): RunLogRetentionResult {
  const { dir, days, dryRun = false } = params;
  if (!Number.isFinite(days) || days < 1) throw new Error("days must be at least 1");
  const cutoffMs = (params.nowMs ?? Date.now()) - days * 86_400_000;
  const result: RunLogRetentionResult = { scanned: 0, removed: 0, kept: 0, failed: 0, bytesRemoved: 0, cutoff: new Date(cutoffMs).toISOString() };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !RUN_LOG_NAME.test(entry.name)) continue;
    result.scanned++;
    const file = path.join(dir, entry.name);
    try {
      const stat = statSync(file);
      if (stat.mtimeMs >= cutoffMs) { result.kept++; continue; }
      if (!dryRun) unlinkSync(file);
      result.removed++;
      result.bytesRemoved += stat.size;
    } catch { result.failed++; }
  }
  return result;
}
