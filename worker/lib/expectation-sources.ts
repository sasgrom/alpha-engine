import { existsSync } from "node:fs";
import path from "node:path";
import { isEightKForm } from "./edgar";
import { exhibitCacheName } from "./exhibits";
import type { ManifestEntry } from "../edgar-fetch.mts";

export interface ExpectationSourceRef { sourceFile: string; sourceId: string; role: "primary" | "exhibit" | "amendment" }

export function expectationSourcesFor(companyCacheDir: string, entry: ManifestEntry): ExpectationSourceRef[] {
  const base = entry.accessionNo.replace(/-/g, "");
  const role = entry.form.endsWith("/A") ? "amendment" : isEightKForm(entry.form) ? "exhibit" : "primary";
  const files: string[] = [];
  if (isEightKForm(entry.form)) {
    if (entry.exhibitFiles?.length) {
      files.push(...entry.exhibitFiles.map((file) => path.join(companyCacheDir, exhibitCacheName(entry.accessionNo, file.name))).filter((file) => existsSync(file)));
    } else {
      const legacy = path.join(companyCacheDir, `${base}.ex.htm`);
      if (entry.exFile && existsSync(legacy)) files.push(legacy);
    }
  }
  if (!files.length) files.push(path.join(companyCacheDir, `${base}.htm`));
  return files.map((sourceFile) => ({ sourceFile, sourceId: `${entry.accessionNo}:${role}:${path.basename(sourceFile)}`, role }));
}
