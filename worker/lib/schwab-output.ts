import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./json-file";

/** Write a reviewed JSON report for both dev and an existing production bundle. */
export function writeSchwabJsonOutputs(fileName: string, value: unknown): void {
  writeJsonAtomic(path.resolve("public/reports", fileName), value, true);
  const distRoot = path.resolve("dist/public");
  if (existsSync(distRoot)) {
    mkdirSync(path.join(distRoot, "reports"), { recursive: true });
    writeJsonAtomic(path.join(distRoot, "reports", fileName), value, true);
  }
}
