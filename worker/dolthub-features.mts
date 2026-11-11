/**
 * Stream DoltHub CSV into DTE feature JSONL with resume manifests. The spot of each snapshot is read from its own
 * quotes (put-call parity), so splits cannot distort the at-the-money selection. Default scope: the 40 tickers of
 * the frozen option research; --all-exported takes every ticker of the export manifest.
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { once } from "node:events";
import path from "node:path";
import { loadEdgarUniverse } from "./lib/edgar";
import { mergeBatches, sha256File } from "./lib/dolthub-export";
import { featureFromRows, FEATURE_SCHEMA_VERSION, impliedSpot, isFeatureManifestCurrent, parseDoltRow, type DoltCsvRow } from "./lib/dolthub-features";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";

interface InputBatch { ticker: string; year: number; file: string; status: string; rows: number; firstDate: string | null; lastDate: string | null }
interface OutputBatch extends InputBatch { inputSha256: string | null; outputSha256: string | null; snapshots: number }
interface Manifest { source: string; schemaVersion: number; generatedAt: string; batches: OutputBatch[] }
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const inputRoot = path.resolve(arg("--input") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\options-iv" : "worker/cache/options-dolthub/export"));
const outRoot = path.resolve(arg("--out") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\options-iv-features" : "worker/cache/options-dolthub/features"));
const currentYear = new Date().getUTCFullYear();
const explicitYears = arg("--years")?.split(",").map(Number).filter(Number.isInteger);
const fromYear = Number(arg("--from-year") ?? 2019), toYear = Number(arg("--to-year") ?? currentYear);
const years = explicitYears?.length ? explicitYears : Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);
const prog = startProgress("dolt-features", `input ${inputRoot} · out ${outRoot}`);
const inputManifest = JSON.parse(readFileSync(path.join(inputRoot, "manifest.json"), "utf8")) as { batches: InputBatch[] };
const tickers = new Set(process.argv.includes("--all-exported")
  ? inputManifest.batches.filter((b) => b.status === "done").map((b) => b.ticker)
  : loadEdgarUniverse("dolthub-universe-40.json").map((c) => c.ticker));
if (only && !tickers.has(only)) throw new Error(`Unknown or non-core ticker ${only}`);
const batches = inputManifest.batches.filter((b) => b.status === "done" && tickers.has(b.ticker) && (!only || b.ticker === only) && years.includes(b.year));
const manifestPath = path.join(outRoot, "manifest.json");
const old: Manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { source: "DoltHub mid-DTE IV with spot from put-call parity", schemaVersion: FEATURE_SCHEMA_VERSION, generatedAt: new Date().toISOString(), batches: [] };
const previousByKey = new Map(old.batches.map((b) => [`${b.ticker}|${b.year}`, b]));
async function processBatch(batch: InputBatch): Promise<OutputBatch> {
  const inputFile = path.resolve(inputRoot, batch.file);
  const outputFile = path.join(outRoot, batch.ticker, `${batch.year}.jsonl`);
  const tmp = `${outputFile}.tmp`;
  mkdirSync(path.dirname(tmp), { recursive: true });
  const input = createInterface({ input: createReadStream(inputFile), crlfDelay: Infinity });
  const output = createWriteStream(tmp);
  let currentDate = "", group: DoltCsvRow[] = [], snapshots = 0, rows = 0, firstDate: string | null = null, lastDate: string | null = null;
  const flush = async () => {
    if (!group.length) return;
    const date = group[0].date, spot = impliedSpot(group);
    const features = featureFromRows(group, spot, new Date().toISOString());
    if (!output.write(`${JSON.stringify(features)}\n`)) await once(output, "drain");
    snapshots++;
    if (!firstDate) firstDate = date;
    lastDate = date;
    group = [];
  };
  for await (const line of input) {
    if (!line || line.startsWith("date,act_symbol,")) continue;
    const row = parseDoltRow(line);
    if (currentDate && row.date !== currentDate) await flush();
    currentDate = row.date;
    group.push(row);
    rows++;
  }
  await flush();
  await new Promise<void>((resolve, reject) => output.end((error: Error | null) => error ? reject(error) : resolve()));
  if (!snapshots) { rmSync(tmp, { force: true }); return { ...batch, rows: 0, snapshots: 0, inputSha256: null, outputSha256: null, firstDate: null, lastDate: null, status: "empty" }; }
  renameSync(tmp, outputFile);
  return { ...batch, rows, snapshots, firstDate, lastDate, inputSha256: await sha256File(inputFile), outputSha256: await sha256File(outputFile), status: "done" };
}
const results: OutputBatch[] = [];
let skipped = 0;
for (const batch of batches) {
  const key = `${batch.ticker}|${batch.year}`, previous = previousByKey.get(key);
  const inputFile = path.resolve(inputRoot, batch.file);
  const outputFile = path.join(outRoot, batch.ticker, `${batch.year}.jsonl`);
  if (previous?.status === "done" && isFeatureManifestCurrent(old) && existsSync(outputFile) && previous.inputSha256 === await sha256File(inputFile) && previous.outputSha256 === await sha256File(outputFile)) {
    results.push(previous); skipped++; continue;
  }
  try {
    const result = await processBatch(batch);
    results.push(result);
    prog.log(`${batch.ticker} ${batch.year}: ${result.snapshots} snapshots · ${result.rows} rows`);
  } catch (error) {
    results.push({ ...batch, rows: 0, snapshots: 0, inputSha256: null, outputSha256: null, firstDate: null, lastDate: null, status: "error", error: String(error).slice(0, 600) });
    prog.log(`! ${batch.ticker} ${batch.year}: ${String(error).slice(0, 300)}`);
  }
  writeJsonAtomic(manifestPath, { ...old, source: "DoltHub mid-DTE IV with spot from put-call parity", schemaVersion: FEATURE_SCHEMA_VERSION, generatedAt: new Date().toISOString(), batches: mergeBatches(old.batches, results) }, true);
}
const errors = results.filter((r) => r.status === "error").length;
writeJsonAtomic(manifestPath, { ...old, source: "DoltHub mid-DTE IV with spot from put-call parity", schemaVersion: FEATURE_SCHEMA_VERSION, generatedAt: new Date().toISOString(), batches: mergeBatches(old.batches, results) }, true);
prog.done(`batches ${results.length} · skipped ${skipped} · snapshots ${results.reduce((n, r) => n + r.snapshots, 0)} · errors ${errors}`);
process.exit(errors ? 1 : 0);
