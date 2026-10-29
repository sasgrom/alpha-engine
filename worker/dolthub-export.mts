/** Resumable DoltHub mid-DTE IV export: one CSV per ticker/year, D: only on Windows. */
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync } from "node:fs";
import path from "node:path";
import { batchSql, csvStats, isAllowedOutputRoot, mergeBatches, readUniverse, sha256File } from "./lib/dolthub-export";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";

interface Company { cik: number; ticker: string }
type BatchStatus = "done" | "empty" | "error";
interface Batch { ticker: string; year: number; file: string; status: BatchStatus; rows: number; firstDate: string | null; lastDate: string | null; sha256: string | null; error?: string }
interface Manifest { source: string; scope: string; generatedAt: string; batches: Batch[] }

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--only")?.toUpperCase() ?? null;
const doltBin = arg("--dolt-bin") ?? "dolt";
const doltRoot = path.resolve(arg("--dolt-root") ?? (process.platform === "win32" ? "D:\\research\\dolt\\options" : "worker/cache/dolt/options"));
const outRoot = path.resolve(arg("--out") ?? (process.platform === "win32" ? "D:\\research\\alpha-engine\\options-iv" : "worker/cache/options-dolthub/export"));
const noResume = process.argv.includes("--no-resume");
const currentYear = new Date().getUTCFullYear();
const explicitYears = arg("--years")?.split(",").map(Number).filter(Number.isInteger);
const fromYear = Number(arg("--from-year") ?? 2019), toYear = Number(arg("--to-year") ?? currentYear);
const years = explicitYears?.length ? explicitYears : Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);
const prog = startProgress("dolt-export", `root ${doltRoot} · out ${outRoot}`);

function validateClone(): void {
  if (!existsSync(path.join(doltRoot, ".dolt"))) throw new Error(`Dolt clone not found at ${doltRoot}; expected .dolt directory`);
  const version = execFileSync(doltBin, ["version"], { encoding: "utf8" }).trim();
  prog.log(version);
  if (!isAllowedOutputRoot(outRoot)) throw new Error("Windows export is allowed only on D:. Pass --out D:\\research\\alpha-engine\\options-iv");
  mkdirSync(outRoot, { recursive: true });
  const realOut = realpathSync(outRoot);
  const fs = statfsSync(realOut);
  if (fs.bavail * fs.bsize < 2 * 1024 ** 3) throw new Error("At least 2 GB free space is required on the export volume");
}
async function runDoltCsv(sql: string, outFile: string): Promise<void> {
  mkdirSync(path.dirname(outFile), { recursive: true });
  const child = spawn(doltBin, ["sql", "-q", sql, "-r", "csv"], { cwd: doltRoot });
  const stream = createWriteStream(outFile);
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    stream.on("error", reject);
    child.on("close", (code) => {
      stream.end(() => {
        if (code === 0) resolve();
        else reject(new Error(`dolt sql exited ${code}: ${stderr.slice(0, 500)}`));
      });
    });
  });
  child.stdout.pipe(stream);
  await done;
}
const manifestPath = path.join(outRoot, "manifest.json");
const old: Manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest
  : { source: "post-no-preference/options", scope: "mid-DTE IV only; no volume/OI/spot", generatedAt: new Date().toISOString(), batches: [] };
const oldByKey = new Map(old.batches.map((b) => [`${b.ticker}|${b.year}`, b]));
const universe = readUniverse<Company>(path.resolve(import.meta.dirname, "dolthub-universe-40.json")).filter((c) => !only || c.ticker === only);
if (only && !universe.length) throw new Error(`Unknown or non-core ticker ${only}`);
if (!years.length || years.some((y) => y < 2019 || y > currentYear)) throw new Error(`Years must be within 2019..${currentYear}`);
validateClone();
const batches: Batch[] = [];
let skipped = 0;
for (const co of universe) {
  for (const year of years) {
    const rel = `${co.ticker}/${year}.csv`, file = path.join(outRoot, rel), key = `${co.ticker}|${year}`;
    const previous = oldByKey.get(key);
    if (!noResume && previous?.status === "done" && existsSync(file) && previous.sha256 === await sha256File(file)) {
      batches.push(previous); skipped++;
      continue;
    }
    const tmp = `${file}.tmp`;
    try {
      rmSync(tmp, { force: true });
      await runDoltCsv(batchSql(co.ticker, year), tmp);
      const stats = csvStats(readFileSync(tmp, "utf8"));
      let batch: Batch;
      if (stats.rows === 0) {
        rmSync(tmp, { force: true });
        batch = { ticker: co.ticker, year, file: rel, status: "empty", rows: 0, firstDate: null, lastDate: null, sha256: null };
      } else {
        renameSync(tmp, file);
        batch = { ticker: co.ticker, year, file: rel, status: "done", ...stats, sha256: await sha256File(file) };
      }
      batches.push(batch);
      prog.log(`${co.ticker} ${year}: ${batch.status} · ${batch.rows} rows`);
    } catch (error) {
      rmSync(tmp, { force: true });
      const message = String(error).slice(0, 600);
      batches.push({ ticker: co.ticker, year, file: rel, status: "error", rows: 0, firstDate: null, lastDate: null, sha256: null, error: message });
      prog.log(`! ${co.ticker} ${year}: ${message}`);
    }
    const manifest: Manifest = { ...old, generatedAt: new Date().toISOString(), batches: mergeBatches(old.batches, batches) };
    writeJsonAtomic(manifestPath, manifest, true);
  }
}
const errors = batches.filter((b) => b.status === "error").length;
const rows = batches.reduce((n, b) => n + b.rows, 0);
writeJsonAtomic(manifestPath, { ...old, generatedAt: new Date().toISOString(), batches: mergeBatches(old.batches, batches) }, true);
prog.done(`batches ${batches.length} · skipped ${skipped} · rows ${rows} · errors ${errors}`);
process.exit(errors ? 1 : 0);
