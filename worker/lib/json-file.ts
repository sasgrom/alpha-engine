import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Rename that waits out a transient Windows lock. Windows refuses to replace a file while another process holds
 * it (a reader, the search indexer, antivirus) and answers EPERM/EBUSY/EACCES; the lock passes within
 * milliseconds. On 2026-11-11 one such refusal on operations-state.json ended the scheduler process. A lock that
 * outlasts every attempt, and any other error, is still thrown.
 */
export function renameWithRetry(
  from: string,
  to: string,
  options: { attempts?: number; waitMs?: number; rename?: (from: string, to: string) => void } = {},
): void {
  const { attempts = 40, waitMs = 50, rename = renameSync } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || !code || !TRANSIENT_RENAME_CODES.has(code)) throw error;
      if (waitMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
}

/** Atomic same-directory replacement: a crash cannot leave half a manifest/outbox. */
export function writeJsonAtomic(file: string, value: unknown, pretty = false): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, pretty ? 1 : 0));
    renameWithRetry(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}
