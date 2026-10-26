// Broken IPv6 egress (Boot Camp / some ISPs) hangs Node's fetch — force IPv4 first.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
/**
 * EDGAR document fetcher (5b, stage 1 of 2 — network only, no GPU needed).
 * Run: npx tsx worker/edgar-fetch.mts [--only TICKER] [--from YYYY-MM-DD]
 *
 * Downloads the FULL history of 10-K/10-Q/8-K primary documents for the EDGAR
 * universe (worker/edgar-universe.json) into worker/cache/edgar/<cik>/<accn>.htm
 * plus a per-company manifest.json (filing list + fetched/scored flags).
 * The scoring stage (edgar-tone.mts) reads ONLY this cache — refetches and
 * re-scores never touch the network twice. Fair access: default 7 req/s serialized.
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";

/** All-night unattended crawl guard: stop before the disk fills up. */
const MIN_FREE_BYTES = 15 * 2 ** 30; // 15 GiB
function assertDiskSpace() {
  try {
    const s = statfsSync(path.resolve(import.meta.dirname));
    if (s.bavail * s.bsize < MIN_FREE_BYTES) {
      console.error(`[edgar-fetch] STOP: free disk space below 15 GiB — clear space and rerun (manifest resumes)`);
      process.exit(2);
    }
  } catch (err: any) {
    if (err?.message?.startsWith("[edgar-fetch]")) throw err;
    // statfs unavailable → don't block the run on a failed check
  }
}
import { fetchDoc, fetchFilingDocument, isPermanentSecMissing, listFilingDocs, listFilings, loadEdgarUniverse, shouldDownloadExhibit, type EdgarFiling } from "./lib/edgar";
import { startProgress } from "./lib/progress";

export interface ManifestEntry extends EdgarFiling {
  docName: string | null;
  fetched: boolean;
  scored: boolean;
  /** 8-K meat lives in EX-99.x — largest textual exhibit cached as <accn>.ex.htm */
  exFile?: string | null;
  exChecked?: boolean;
  error?: string;
  /** consecutive fetch failures; ≥ MAX_FAILURES → dead (SEC link is truly gone) */
  failCount?: number;
  dead?: boolean;
}

/** 404/410 marks a document dead immediately; other failures get three runs.
 * --retry-failed resurrects deliberately. No repeated exponential backoff for
 * links that SEC has already told us do not exist. */
const MAX_FAILURES = 3;

const cacheDir = (cik: number) => path.resolve(import.meta.dirname, "cache", "edgar", String(cik));
const manifestPath = (cik: number) => path.join(cacheDir(cik), "manifest.json");

export function loadManifest(cik: number): ManifestEntry[] {
  try { return JSON.parse(readFileSync(manifestPath(cik), "utf8")); } catch { return []; }
}
function saveManifest(cik: number, rows: ManifestEntry[]) {
  mkdirSync(cacheDir(cik), { recursive: true });
  writeFileSync(manifestPath(cik), JSON.stringify(rows, null, 1));
}

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;
const fromIdx = process.argv.indexOf("--from");
const from = fromIdx > -1 ? process.argv[fromIdx + 1] : null; // YYYY-MM-DD lower bound
// --from-ticker TICKER: skip companies BEFORE this one in the universe order
// (owner: resume mid-index without re-walking finished companies)
const fromTickerIdx = process.argv.indexOf("--from-ticker");
const fromTicker = fromTickerIdx > -1 ? process.argv[fromTickerIdx + 1]?.toUpperCase() : null;
// --retry-failed: also retry entries declared dead after MAX_FAILURES
const retryFailed = process.argv.includes("--retry-failed");
const universeIdx = process.argv.indexOf("--universe");
const universeFile = universeIdx > -1 ? process.argv[universeIdx + 1] : "edgar-universe.json";

const universeAll = loadEdgarUniverse(universeFile).filter((c) => !only || c.ticker === only);
let universe = universeAll;
if (fromTicker) {
  const idx = universeAll.findIndex((c) => c.ticker === fromTicker);
  if (idx === -1) { console.error(`[edgar-fetch] unknown --from-ticker ${fromTicker}`); process.exit(1); }
  universe = universeAll.slice(idx);
}
if (only && universe.length === 0) { console.error(`[edgar-fetch] unknown ticker ${only}`); process.exit(1); }

const prog = startProgress("edgar-fetch", `${universe.length} companies${only ? ` (only ${only})` : ""}${from ? `, from ${from}` : ""}, universe=${universeFile}`);
const totalCompanies = universe.length;
let companyIdx = 0;

for (const co of universe) {
  companyIdx++;
  // one bad CIK (stale snapshot row, delisted entity) must NEVER kill a
  // 500-company overnight crawl — log and move on (proven by AIG: the GICS
  // snapshot carried CIK 5271, real is 5272; 404 crashed the whole run)
  let filingsAll: EdgarFiling[];
  try { filingsAll = await listFilings(co.cik); }
  catch (err) { prog.log(`x ${co.ticker} (CIK ${co.cik}): company-level error, SKIPPED — ${String(err).slice(0, 150)}`); continue; }
  const filings = filingsAll.filter((f) => !from || f.filingDate >= from);
  const manifest = loadManifest(co.cik);
  const known = new Map(manifest.map((m) => [m.accessionNo, m]));
  let fresh = 0, fetched = 0, failed = 0, exhibitFetched = 0;
  prog.stage(`${co.ticker} [${companyIdx}/${totalCompanies}]: ${filings.length} filings (10-K/10-Q/8-K)`);
  for (let i = 0; i < filings.length; i++) {
    const f = filings[i];
    let entry = known.get(f.accessionNo);
    if (!entry) {
      entry = { ...f, docName: null, fetched: false, scored: false };
      manifest.push(entry);
      known.set(f.accessionNo, entry);
      fresh++;
    }
    // legacy errors (pre-dead-flag runs) get two last chances, not infinity
    if (!entry.fetched && entry.error && entry.failCount === undefined) entry.failCount = 1;
    // 8-K exhibit pass (5c): even when the primary doc is cached, grab the
    // largest textual exhibit — earnings 8-Ks carry the press release in
    // EX-99.x while the primary doc is cover + one sentence.
    const base = entry.accessionNo.replace(/-/g, "");
    const exPath = path.join(cacheDir(co.cik), `${base}.ex.htm`);
    const needsExhibit = shouldDownloadExhibit(entry, existsSync(exPath));
    if (entry.fetched && !needsExhibit) {
      if (entry.form === "8-K" && !entry.exChecked && entry.exFile && existsSync(exPath)) entry.exChecked = true;
      continue;
    }
    if (entry.fetched && needsExhibit) {
      try {
        const textual = (await listFilingDocs(co.cik, entry.accessionNo))
          .filter((d) => /\.(htm|txt)$/i.test(d.name) && !/^index/i.test(d.name) && d.name !== entry.docName);
        const largest = textual.sort((a, b) => b.size - a.size)[0];
        if (largest && largest.size > 20_000) {
          writeFileSync(path.join(cacheDir(co.cik), `${entry.accessionNo.replace(/-/g, "")}.ex.htm`), await fetchDoc(co.cik, entry.accessionNo, largest.name));
          entry.exFile = largest.name;
          exhibitFetched++;
        }
        entry.exChecked = true;
      } catch (err) {
        entry.error = String(err).slice(0, 200);
        if (isPermanentSecMissing(err)) entry.exChecked = true; // no exhibit to retry
      }
      continue;
    }
    if (entry.dead && !retryFailed) continue; // dead links stay dead (62s backoff each)
    if (entry.fetched) continue;
    try {
      const { docName, html } = await fetchFilingDocument(co.cik, f);
      mkdirSync(cacheDir(co.cik), { recursive: true });
      writeFileSync(path.join(cacheDir(co.cik), `${f.accessionNo.replace(/-/g, "")}.htm`), html);
      entry.docName = docName;
      entry.fetched = true;
      delete entry.error;
      delete entry.dead;
      entry.failCount = 0;
      fetched++;
    } catch (err) {
      entry.error = String(err).slice(0, 200);
      if (isPermanentSecMissing(err)) {
        entry.dead = true;
        entry.failCount = MAX_FAILURES;
      } else {
        entry.failCount = (entry.failCount ?? 0) + 1;
        if (entry.failCount >= MAX_FAILURES) entry.dead = true;
      }
      failed++;
    }
    if ((i + 1) % 25 === 0) {
      assertDiskSpace();
      saveManifest(co.cik, manifest);
      prog.item(i + 1, filings.length, `${fetched} primary + ${exhibitFetched} EX-99, ${failed} failed`);
    }
  }
  saveManifest(co.cik, manifest);
  prog.stageDone(`${co.ticker}: ${filings.length} filings, ${fresh} new, ${fetched} primary, ${exhibitFetched} EX-99, ${failed} failed`);
}
prog.done(`all done — ${totalCompanies} companies`);
