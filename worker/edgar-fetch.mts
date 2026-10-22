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
 * re-scores never touch the network twice. Fair access: ~3 req/s serialized.
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchFilingDocument, listFilings, loadEdgarUniverse, type EdgarFiling } from "./lib/edgar";

export interface ManifestEntry extends EdgarFiling {
  docName: string | null;
  fetched: boolean;
  scored: boolean;
  error?: string;
}

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

const universe = loadEdgarUniverse().filter((c) => !only || c.ticker === only);
if (only && universe.length === 0) { console.error(`[edgar-fetch] unknown ticker ${only}`); process.exit(1); }

for (const co of universe) {
  const filings = (await listFilings(co.cik)).filter((f) => !from || f.filingDate >= from);
  const manifest = loadManifest(co.cik);
  const known = new Map(manifest.map((m) => [m.accessionNo, m]));
  let fresh = 0, fetched = 0, failed = 0;
  console.log(`[edgar-fetch] ${co.ticker}: ${filings.length} filings (10-K/10-Q/8-K${from ? `, from ${from}` : ""})`);
  for (let i = 0; i < filings.length; i++) {
    const f = filings[i];
    let entry = known.get(f.accessionNo);
    if (!entry) {
      entry = { ...f, docName: null, fetched: false, scored: false };
      manifest.push(entry);
      known.set(f.accessionNo, entry);
      fresh++;
    }
    if (entry.fetched) continue;
    try {
      const { docName, html } = await fetchFilingDocument(co.cik, f);
      mkdirSync(cacheDir(co.cik), { recursive: true });
      writeFileSync(path.join(cacheDir(co.cik), `${f.accessionNo.replace(/-/g, "")}.htm`), html);
      entry.docName = docName;
      entry.fetched = true;
      delete entry.error;
      fetched++;
    } catch (err) {
      entry.error = String(err).slice(0, 200);
      failed++;
    }
    if ((i + 1) % 25 === 0) {
      saveManifest(co.cik, manifest);
      console.log(`[edgar-fetch] ${co.ticker}: ${i + 1}/${filings.length} (${fetched} downloaded, ${failed} failed)`);
    }
  }
  saveManifest(co.cik, manifest);
  console.log(`[edgar-fetch] ${co.ticker} DONE: ${filings.length} filings, ${fresh} new in manifest, ${fetched} downloaded this run, ${failed} failed`);
}
console.log("[edgar-fetch] all done");
