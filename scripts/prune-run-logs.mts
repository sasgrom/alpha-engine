/** Remove the scheduler's per-run logs older than --days (default 14). --dry only counts. */
import { OPERATIONS_RUNS_DIR } from "../worker/lib/operations-scheduler";
import { pruneRunLogs } from "../worker/lib/run-log-retention";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const days = Number(arg("--days") ?? 14);
const dryRun = process.argv.includes("--dry");
const result = pruneRunLogs({ dir: OPERATIONS_RUNS_DIR, days, dryRun });
console.log(`[run-log-retention] ${dryRun ? "dry run · " : ""}${result.removed} of ${result.scanned} run logs older than ${days} days ${dryRun ? "would be removed" : "removed"} · ${(result.bytesRemoved / 1_048_576).toFixed(1)} MB · kept ${result.kept} · failed ${result.failed} · cutoff ${result.cutoff}`);
if (result.failed) process.exitCode = 1;
