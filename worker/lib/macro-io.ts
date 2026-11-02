import { mkdirSync, realpathSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isAllowedOutputRoot } from "./dolthub-export";

export function prepareMacroRoot(root: string): string {
  if (!isAllowedOutputRoot(root)) throw new Error("Windows macro archives are allowed only on D:. Pass --out D:\\research\\alpha-engine\\macro");
  mkdirSync(root, { recursive: true });
  const realRoot = realpathSync(root);
  const fs = statfsSync(realRoot);
  if (fs.bavail * fs.bsize < 2 * 1024 ** 3) throw new Error("At least 2 GB free space is required on the macro volume");
  return realRoot;
}

export function writeTextAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}
