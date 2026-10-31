/** Validate exported DoltHub CSV files against manifest, content and hashes. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { inspectCsv, sha256File } from "./lib/dolthub-export";
import { writeJsonAtomic } from "./lib/json-file";

interface Batch { ticker: string; year: number; file: string; status: "done" | "empty" | "error"; rows: number; firstDate: string | null; lastDate: string | null; sha256: string | null; error?: string }
interface Manifest { batches: Batch[] }
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const root = path.resolve(arg("--root") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\options-iv" : "worker/cache/options-dolthub/export"));
const full = process.argv.includes("--full");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const errors: string[] = [], warnings: string[] = [];
let rows = 0, checked = 0, duplicates = 0;
if (full && manifest.batches.length !== 320) errors.push(`Expected 320 batches for 40 tickers × 8 years, got ${manifest.batches.length}`);
if (full && new Set(manifest.batches.map((b) => b.ticker)).size !== 40) errors.push("Expected exactly 40 distinct tickers");
for (const batch of manifest.batches) {
  if (batch.status === "error") { errors.push(`${batch.ticker} ${batch.year}: ${batch.error ?? "export error"}`); continue; }
  if (batch.status === "empty") { warnings.push(`${batch.ticker} ${batch.year}: empty batch`); continue; }
  const file = path.resolve(root, batch.file);
  if (!file.startsWith(`${root}${path.sep}`)) { errors.push(`${batch.ticker} ${batch.year}: path escapes export root`); continue; }
  if (!existsSync(file)) { errors.push(`${batch.ticker} ${batch.year}: missing ${batch.file}`); continue; }
  const inspection = inspectCsv(readFileSync(file, "utf8"));
  const hash = await sha256File(file);
  if (inspection.rows !== batch.rows) errors.push(`${batch.ticker} ${batch.year}: rows ${inspection.rows} != manifest ${batch.rows}`);
  if (inspection.firstDate !== batch.firstDate) errors.push(`${batch.ticker} ${batch.year}: firstDate ${inspection.firstDate} != manifest ${batch.firstDate}`);
  if (inspection.lastDate !== batch.lastDate) errors.push(`${batch.ticker} ${batch.year}: lastDate ${inspection.lastDate} != manifest ${batch.lastDate}`);
  if (hash !== batch.sha256) errors.push(`${batch.ticker} ${batch.year}: SHA256 mismatch`);
  if (inspection.invalidRows) errors.push(`${batch.ticker} ${batch.year}: ${inspection.invalidRows} invalid/unsorted rows`);
  if (inspection.duplicates) { duplicates += inspection.duplicates; warnings.push(`${batch.ticker} ${batch.year}: ${inspection.duplicates} duplicate contract keys`); }
  rows += inspection.rows;
  checked++;
}
const report = { generatedAt: new Date().toISOString(), root, checked, rows, duplicates, errors, warnings };
writeJsonAtomic(path.join(root, "validation.json"), report, true);
console.log(JSON.stringify({ checked, rows, duplicates, errors: errors.length, warnings: warnings.length }, null, 2));
if (errors.length) console.error(errors.slice(0, 40).join("\n"));
process.exit(errors.length ? 1 : 0);
