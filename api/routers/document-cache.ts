import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Match a documents row to a cached worker file via the cache manifest. */
export function readWorkerCacheDoc(cik: number, accessionNo: string, docName: string): string | null {
  try {
    const dir = path.resolve(process.cwd(), "worker", "cache", "edgar", String(cik));
    const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as any[];
    const entry = manifest.find((m) => m.accessionNo === accessionNo);
    const base = accessionNo.replace(/-/g, "");
    let file: string | null = null;
    if (entry?.docName === docName) file = path.join(dir, `${base}.htm`);
    else if (entry?.exFile === docName) file = path.join(dir, `${base}.ex.htm`);
    if (file && existsSync(file)) return readFileSync(file, "utf8");
    return null;
  } catch {
    return null;
  }
}
