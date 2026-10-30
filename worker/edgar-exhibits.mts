// Network-only, expectations-specific complete EX-99 cache. Legacy tone files are untouched.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fetchDoc, isEightKForm, listFilingDocs, loadEdgarUniverse, realCacheRoot } from "./lib/edgar";
import { exhibitCacheName, selectSubstantiveExhibits } from "./lib/exhibits";
import { selectLatestFilings } from "./lib/filing-selection";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";
import type { CachedExhibitFile, ManifestEntry } from "./edgar-fetch.mts";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const from = arg("--from");
const fromTicker = arg("--from-ticker")?.toUpperCase() ?? null;
const universeFile = arg("--universe") ?? "edgar-universe.json";
const force = process.argv.includes("--force");
const benchmarkOnly = process.argv.includes("--benchmark");
const latestOnly = process.argv.includes("--latest");
const benchmarkAccessions = benchmarkOnly
  ? new Set((JSON.parse(readFileSync(path.resolve("research/expectations-benchmark-v1.json"), "utf8")) as { documents: { accessionNo: string }[] }).documents.map((doc) => doc.accessionNo))
  : null;
const MAX_FILING_BYTES = 50 * 1024 * 1024;
const MIN_FREE_BYTES = 15 * 2 ** 30;
const cacheDir = (cik: number) => path.resolve(import.meta.dirname, "cache", "edgar", String(cik));
const manifestPath = (cik: number) => path.join(cacheDir(cik), "manifest.json");
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fileSha256 = (file: string) => sha256(readFileSync(file));
function writeTextAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { writeFileSync(tmp, text); renameSync(tmp, file); }
  finally { rmSync(tmp, { force: true }); }
}
function assertDiskSpace() {
  const stats = statfsSync(realCacheRoot(path.resolve(import.meta.dirname, "cache")));
  if (stats.bavail * stats.bsize < MIN_FREE_BYTES) throw new Error("Free disk space below 15 GiB; checkpoint saved");
}
function readManifest(cik: number): ManifestEntry[] {
  try { return JSON.parse(readFileSync(manifestPath(cik), "utf8")); } catch { return []; }
}
function validCachedFiles(cik: number, accessionNo: string, files: CachedExhibitFile[] | undefined): boolean {
  return Boolean(files && files.every((file) => {
    try { return fileSha256(exhibitPath(cik, accessionNo, file.name)) === file.sha256; }
    catch { return false; }
  }));
}
const exhibitPath = (cik: number, accessionNo: string, name: string) => path.join(cacheDir(cik), exhibitCacheName(accessionNo, name));

const universeAll = loadEdgarUniverse(universeFile).filter((company) => !only || company.ticker === only);
if (only && !universeAll.length) throw new Error(`Unknown ticker ${only}`);
const start = fromTicker ? universeAll.findIndex((company) => company.ticker === fromTicker) : 0;
if (fromTicker && start < 0) throw new Error(`Unknown --from-ticker ${fromTicker}`);
const universe = universeAll.slice(Math.max(0, start));
const prog = startProgress("edgar-exhibits", `complete EX-99 cache · ${force ? "force" : "resume"} · tone unchanged`);
const totals = { complete: 0, downloaded: 0, resumed: 0, failed: 0, bytes: 0 };
for (const company of universe) {
  assertDiskSpace();
  const file = manifestPath(company.cik);
  const manifest = readManifest(company.cik);
  if (!manifest.length) { prog.log(`${company.ticker}: no manifest`); continue; }
  mkdirSync(cacheDir(company.cik), { recursive: true });
  const eligible = manifest.filter((entry) => entry.fetched && isEightKForm(entry.form) && (!from || entry.filingDate >= from) && (!benchmarkAccessions || benchmarkAccessions.has(entry.accessionNo)));
  const filings = latestOnly ? selectLatestFilings(eligible).filter((entry) => entry.form === "8-K") : eligible;
  for (const entry of filings) {
    if (!force && entry.exhibitsComplete && validCachedFiles(company.cik, entry.accessionNo, entry.exhibitFiles)) { totals.resumed++; continue; }
    try {
      const selected = selectSubstantiveExhibits(await listFilingDocs(company.cik, entry.accessionNo), entry.docName);
      const bytes = selected.reduce((sum, doc) => sum + doc.size, 0);
      if (bytes > MAX_FILING_BYTES) throw new Error(`EX-99 set exceeds 50 MiB safety limit (${bytes} bytes)`);
      const cached: CachedExhibitFile[] = [];
      for (const doc of selected) {
        const target = exhibitPath(company.cik, entry.accessionNo, doc.name);
        let text: string;
        if (!force && existsSync(target)) text = readFileSync(target, "utf8");
        else {
          text = await fetchDoc(company.cik, entry.accessionNo, doc.name);
          writeTextAtomic(target, text);
          totals.downloaded++;
        }
        cached.push({ name: doc.name, size: Buffer.byteLength(text), sha256: sha256(text) });
        totals.bytes += Buffer.byteLength(text);
      }
      entry.exhibitFiles = cached.sort((a, b) => a.name.localeCompare(b.name));
      entry.exhibitsComplete = true;
      delete entry.error;
      totals.complete++;
    } catch (error) {
      entry.exhibitsComplete = false;
      entry.error = String(error).slice(0, 300);
      totals.failed++;
    }
    writeJsonAtomic(file, manifest, true);
  }
  writeJsonAtomic(file, manifest, true);
  prog.stageDone(`${company.ticker}: ${filings.length} 8-K filings · complete ${totals.complete} · downloaded ${totals.downloaded} · failed ${totals.failed}`);
}
prog.done(`all done · complete ${totals.complete} · resumed ${totals.resumed} · downloaded ${totals.downloaded} · failed ${totals.failed} · ${(totals.bytes / 1e6).toFixed(1)} MB`);
