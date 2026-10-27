import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Atomic same-directory replacement: a crash cannot leave half a manifest/outbox. */
export function writeJsonAtomic(file: string, value: unknown, pretty = false): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, pretty ? 1 : 0));
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}
