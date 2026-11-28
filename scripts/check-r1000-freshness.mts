import "dotenv/config";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { secGet } from "../worker/lib/edgar";
import { listFilingsDetailed } from "../worker/lib/edgar-listing";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { r1000CompanyFactsPeriod, r1000DeterministicSample, r1000LastCandle, r1000LatestFiling } from "../worker/lib/r1000-freshness";
import { createSchwabSession } from "../worker/lib/schwab-paced";
import { schwabDailyPriceHistoryPath } from "../worker/lib/schwab";
import { schwabSymbol } from "../worker/lib/schwab-price-series";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const universeFile = path.resolve(arg("--universe") ?? "worker/research-universe-r1000-current.json");
const universe = JSON.parse(readFileSync(universeFile, "utf8")) as { cik: number; ticker: string }[];
const count = Number(arg("--count") ?? 20), seed = Number(arg("--seed") ?? 35);
if (!Number.isInteger(count) || count < 1 || !Number.isInteger(seed)) throw new Error("--count must be positive and --seed an integer");
const sample = r1000DeterministicSample(universe, count, seed), market = process.argv.includes("--market");
const scope = { sample: sample.map(row => row.cik), market, universeSha256: sha(readFileSync(universeFile)) };
const codeHash = sha([fileURLToPath(import.meta.url), "worker/lib/r1000-freshness.ts"].map(file => readFileSync(path.resolve(file))).join("\0"));
const root = path.resolve(arg("--resume") ?? arg("--out") ?? `D:/research/alpha-engine/engine/r1000-freshness/${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}`);
mkdirSync(root, { recursive: true });
if (!/^d:/i.test(realpathSync(root))) throw new Error("Freshness evidence must resolve to D:");
const runFile = path.join(root, "run.json");
let manifest: any = { schemaVersion: 1, status: "running", pid: process.pid, scope, codeHash, results: [] };
if (arg("--resume")) {
  const previous = JSON.parse(readFileSync(runFile, "utf8"));
  if (previous.schemaVersion !== 1 || previous.codeHash !== codeHash || JSON.stringify(previous.scope) !== JSON.stringify(scope)) throw new Error("Freshness resume identity differs");
  manifest = previous;
}
mkdirSync(path.join(root, "companies"), { recursive: true });
const completed = new Set(manifest.results.filter((row: any) => row.pass === true).map((row: any) => row.cik));
function save() {
  const latest = new Map<number, any>();
  for (const row of manifest.results) latest.set(row.cik, row);
  manifest.results = [...latest.values()];
  manifest.counts = { companies: manifest.results.length, passed: manifest.results.filter((row: any) => row.pass).length, failed: manifest.results.filter((row: any) => !row.pass).length };
  manifest.status = manifest.results.length === sample.length && manifest.results.every((row: any) => row.pass) ? "complete" : "partial";
  manifest.updatedAt = new Date().toISOString();
  writeJsonAtomic(runFile, manifest, true);
}
save();
const schwab = market ? createSchwabSession({ log: line => console.log(`[freshness] ${line}`) }) : null;
await schwab?.prepare();
for (const company of sample) {
  if (completed.has(company.cik)) {
    const checkpoint = manifest.results.find((row: any) => row.cik === company.cik);
    if (sha(readFileSync(checkpoint.checkpoint.file)) !== checkpoint.checkpoint.sha256) throw new Error(`Damaged freshness checkpoint: ${company.ticker}`);
    console.log(`[freshness] ${company.ticker} resumed`);
    continue;
  }
  let result: any = { cik: company.cik, ticker: company.ticker, pass: false };
  try {
    const sourceFilings = await listFilingsDetailed(company.cik);
    const sourceLatest = r1000LatestFiling(sourceFilings);
    const cached = JSON.parse(readFileSync(path.resolve("worker/cache/edgar", String(company.cik), "manifest.json"), "utf8"));
    const cachedLatest = r1000LatestFiling(cached);
    const sourceText = await (await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(company.cik).padStart(10, "0")}.json`)).text();
    const sourceFacts = JSON.parse(sourceText), cachedFacts = JSON.parse(readFileSync(path.resolve("worker/cache/companyfacts", `${company.cik}.json`), "utf8"));
    const factsManifest = JSON.parse(readFileSync(path.resolve("worker/cache/companyfacts/manifest", `${company.cik}.json`), "utf8"));
    const sourcePeriod = r1000CompanyFactsPeriod(sourceFacts), cachedPeriod = r1000CompanyFactsPeriod(cachedFacts);
    const sourceFactsHash = sha(JSON.stringify(sourceFacts)), cachedFactsHash = sha(JSON.stringify(cachedFacts));
    const filingPass = Boolean(sourceLatest && cachedLatest && sourceLatest.accessionNo === cachedLatest.accessionNo && sourceLatest.form === cachedLatest.form && sourceLatest.filingDate === cachedLatest.filingDate);
    const factsPass = sourcePeriod !== null && cachedPeriod !== null && sourcePeriod === cachedPeriod && sourceFactsHash === cachedFactsHash && factsManifest.rawSha256 === cachedFactsHash;
    result = {
      ...result,
      filing: { source: sourceLatest, cached: cachedLatest, sourceNormalizedHash: sha(JSON.stringify(sourceFilings)), pass: filingPass },
      facts: { sourcePeriod, cachedPeriod, sourcePayloadHash: sourceFactsHash, cachedPayloadHash: cachedFactsHash, sourceBodySha256: sha(sourceText), manifestSha256: factsManifest.rawSha256, pass: factsPass },
    };
    if (schwab) {
      const raw = await schwab.get(schwabDailyPriceHistoryPath(schwabSymbol(company.ticker), Date.now()));
      const source = r1000LastCandle(JSON.parse(raw));
      const cached = r1000LastCandle(JSON.parse(readFileSync(path.join("D:/research/alpha-engine/schwab-r1000", "pricehistory", `${company.ticker}.json`), "utf8")));
      result.schwab = { source, cached, sourceBodySha256: sha(raw), pass: Boolean(source && cached && source.date === cached.date && source.close === cached.close) };
    }
    result.pass = result.filing.pass && result.facts.pass && (!schwab || result.schwab.pass);
  } catch (error) {
    result.error = String(error).slice(0, 500);
  }
  const file = path.join(root, "companies", `${company.cik}-${Date.now()}.json`);
  writeJsonAtomic(file, result, true);
  manifest.results.push({ ...result, checkpoint: { file, sha256: sha(readFileSync(file)) } });
  save();
  console.log(`[freshness] ${company.ticker}: ${result.pass ? "pass" : "fail"}${result.error ? ` ${result.error}` : ""}`);
}
if (schwab) {
  const pointer = JSON.parse(readFileSync("D:/research/alpha-engine/engine/r1000-panel/current.json", "utf8"));
  const panelFile = path.join(pointer.panel, "px.npz");
  const panelDate = spawnSync("python", ["-c", "import numpy as np,sys; print(np.load(sys.argv[1])['dates'][-1])", panelFile], { encoding: "utf8" });
  if (panelDate.error || panelDate.status !== 0) throw new Error(`Panel date could not be read: ${panelDate.stderr}`);
  const benchmarkRaw = await schwab.get(schwabDailyPriceHistoryPath("SPY", Date.now()));
  const benchmark = r1000LastCandle(JSON.parse(benchmarkRaw));
  manifest.panel = { panel: pointer.panel, date: panelDate.stdout.trim(), benchmark, benchmarkBodySha256: sha(benchmarkRaw), pass: panelDate.stdout.trim() === benchmark?.date };
  save();
}
manifest.pass = manifest.status === "complete" && (!schwab || manifest.panel?.pass === true);
save();
console.log(JSON.stringify({ runFile, pass: manifest.pass, counts: manifest.counts, panel: manifest.panel ?? null }, null, 1));
if (!manifest.pass) process.exitCode = 1;
