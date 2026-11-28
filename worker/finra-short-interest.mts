/**
 * FINRA short interest: fetch the settlement files the archive lacks, then write the desk's per-company history.
 *
 *   npx tsx worker/finra-short-interest.mts [--days 100] [--keep 24] [--no-fetch] [--dry-run]
 *
 * The raw files stay unchanged in D:\research\alpha-engine\shortint\finra\raw with a manifest (SHA-256, bytes, rows);
 * a file already there is never fetched again or rewritten. FINRA publishes a settlement about seven business days
 * later, so a date that answers 403 or 404 is simply not out yet and is asked again on a later run. Public CDN, one
 * request a second, a generic client name, no account. The desk file (worker/.runs/desk-short-interest.json) holds
 * the newest --keep settlements for every registry company FINRA lists.
 *
 * A missing archive folder stops the run (the D: drive may be away): nothing is created in its place.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../api/queries/connection";
import { buildDeskShortInterest, FINRA_SHORT_INTEREST_URL, parseFinraShortInterest, r1000FinraCompanies, shareCountsFromStatements, shortInterestCandidates, type ShareCount } from "./lib/finra-short-interest";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const root = path.resolve(arg("--root") ?? "D:/research/alpha-engine/shortint/finra");
const out = path.resolve(arg("--out") ?? "worker/.runs/desk-short-interest.json");
const universeFile = arg("--universe");
const days = Number(arg("--days") ?? 100), keep = Number(arg("--keep") ?? 24);
const dryRun = process.argv.includes("--dry-run"), noFetch = process.argv.includes("--no-fetch") || dryRun;
if (!Number.isInteger(days) || days < 20 || !Number.isInteger(keep) || keep < 2) throw new Error("--days must be at least 20 and --keep at least 2");

const raw = path.join(root, "raw"), manifestFile = path.join(root, "manifest.json");
if (!existsSync(raw) || !existsSync(manifestFile)) throw new Error(`The FINRA short interest archive is not at ${root}; nothing was fetched or created`);
if (!/^d:/i.test(realpathSync(raw)) && !arg("--root")) throw new Error("The FINRA short interest archive must resolve to D:");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { source: string; files: Record<string, { bytes: number; sha256: string; rows: number; fetchedAt: string }>; missing?: unknown[] };
const fileOf = (date: string) => path.join(raw, `shrt${date.replaceAll("-", "")}.csv`);
const prog = startProgress("finra-short-interest", `archive ${root} · ${Object.keys(manifest.files).length} files${noFetch ? " · no fetch" : ""}`);

let fetched = 0, requests = 0;
const notOut: string[] = [];
if (!noFetch) {
  const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  for (const group of shortInterestCandidates(from, today)) {
    if (group.some((date) => existsSync(fileOf(date)))) continue;
    let found = false;
    for (const date of group) {
      const key = date.replaceAll("-", "");
      let body: Buffer | null = null;
      for (let attempt = 1; attempt <= 2 && body === null; attempt++) {
        if (requests > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
        requests++;
        try {
          const response = await fetch(`${FINRA_SHORT_INTEREST_URL}shrt${key}.csv`, { headers: { "User-Agent": "Mozilla/5.0 (research client)" }, signal: AbortSignal.timeout(60_000) });
          if (response.status === 403 || response.status === 404) break;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          body = Buffer.from(await response.arrayBuffer());
        } catch (error) {
          if (attempt === 2) throw new Error(`FINRA short interest ${key}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!body) continue;
      const rows = parseFinraShortInterest(body.toString("utf8"));
      if (rows[0].settlementDate !== date) throw new Error(`The file shrt${key}.csv holds the settlement ${rows[0].settlementDate}; nothing was stored`);
      writeFileSync(fileOf(date), body, { flag: "wx" });
      manifest.files[key] = { bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), rows: rows.length, fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
      writeJsonAtomic(manifestFile, manifest, true);
      fetched++;
      found = true;
      prog.log(`stored shrt${key}.csv · ${rows.length} rows`);
      break;
    }
    if (!found) notOut.push(group[0]);
  }
}

// the desk's history from the newest settlements in the archive; every file is checked against its manifest hash
const names = readdirSync(raw).filter((name) => /^shrt\d{8}\.csv$/.test(name)).sort().slice(-keep);
const files = names.map((name) => {
  const body = readFileSync(path.join(raw, name)), entry = manifest.files[name.slice(4, 12)];
  if (!entry) throw new Error(`${name} is in the archive but not in its manifest; the desk file was not rebuilt`);
  if (createHash("sha256").update(body).digest("hex") !== entry.sha256) throw new Error(`${name} does not match its manifest hash; the desk file was not rebuilt`);
  return parseFinraShortInterest(body.toString("utf8"));
});
const companies = universeFile
  ? r1000FinraCompanies(JSON.parse(readFileSync(path.resolve("worker", universeFile), "utf8")))
  : await (async () => {
    const client = getDb().$client.promise();
    const [rows] = await client.query("SELECT cik, ticker FROM companies WHERE ticker IS NOT NULL AND ticker <> ''") as [Array<{ cik: number; ticker: string }>, unknown];
    await client.end();
    return rows;
  })();
// share counts from the desk's statements files (fundamentals standard); a company without one gets no share of shares
const statementsDir = path.resolve("worker/.runs/desk-company/statements");
const shareCounts = new Map<number, ShareCount[]>();
for (const row of companies) {
  const file = path.join(statementsDir, `${Number(row.cik)}.json`);
  if (existsSync(file)) shareCounts.set(Number(row.cik), shareCountsFromStatements(JSON.parse(readFileSync(file, "utf8"))));
}
const result = buildDeskShortInterest({ files, companies: companies.map((row) => ({ cik: Number(row.cik), ticker: String(row.ticker) })), builtAt: new Date().toISOString(), shareCounts });
if (!dryRun) writeJsonAtomic(out, result);
const covered = Object.keys(result.companies).length;
const withShare = Object.values(result.companies).filter((points) => points[0]?.shareOfShares != null).length;
prog.done(`${dryRun ? "dry run · " : ""}fetched ${fetched} (${requests} requests)${notOut.length ? ` · not out yet: ${notOut.join(", ")}` : ""} · settlements ${result.settlements.at(-1)} to ${result.asOf} (${result.settlements.length}) · ${covered} of ${companies.length} companies (${withShare} with a share of shares)${result.ambiguous.length ? ` · shared symbols left out: ${result.ambiguous.join(", ")}` : ""} · ${out}`);
process.exit(0);
