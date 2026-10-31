import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
/**
 * Home companyfacts collector: SEC JSON → D: cache → LOCAL factsSnapshot ingest.
 * No prod writes. Run: npx tsx worker/facts-fetch.mts [--only XOM] [--cached]
 */
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { companyFacts, factsToRows, loadEdgarUniverse } from "./lib/edgar";
import { postFactsSnapshot } from "./lib/ingest";
import { writeJsonAtomic } from "./lib/json-file";
import { startProgress } from "./lib/progress";

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;
const universeIdx = process.argv.indexOf("--universe");
const universeFile = universeIdx > -1 ? process.argv[universeIdx + 1] : "edgar-universe-35.json";
const useCached = process.argv.includes("--cached");
const universe = loadEdgarUniverse(universeFile).filter((c) => !only || c.ticker === only);
if (only && universe.length === 0) { console.error(`[facts-fetch] unknown ticker ${only}`); process.exit(1); }
const ingestUrl = process.env.INGEST_URL ?? "http://127.0.0.1:3000/api/worker/ingest";
if (!/^http:\/\/(127\.0\.0\.1|localhost):3000\//.test(ingestUrl)) {
  console.error(`[facts-fetch] local-first requires a local INGEST_URL, got ${ingestUrl}`);
  process.exit(1);
}
const prog = startProgress("facts-fetch", `${universe.length} companies · local ingest · ${useCached ? "cached" : "fresh SEC"}`);
let done = 0, failed = 0, rowsTotal = 0;
for (const [index, co] of universe.entries()) {
  const rawPath = path.resolve(import.meta.dirname, "cache", "companyfacts", `${co.cik}.json`);
  try {
    let payload: any;
    if (useCached) {
      if (!existsSync(rawPath)) throw new Error("no cached companyfacts payload");
      payload = JSON.parse(readFileSync(rawPath, "utf8"));
    } else {
      payload = await companyFacts(co.cik);
    }
    const rows = factsToRows(payload);
    if (rows.length === 0) throw new Error("SEC returned zero fact rows; existing facts kept");
    writeJsonAtomic(rawPath, payload);
    const res = await postFactsSnapshot(co.cik, rows, { url: ingestUrl });
    rowsTotal += rows.length;
    done++;
    prog.item(index + 1, universe.length, `${co.ticker} ${rows.length} facts · ${res.replaced} replaced · ${done} ok · ${failed} failed`);
  } catch (e: any) {
    failed++;
    prog.log(`x ${co.ticker} (${co.cik}): ${String(e?.message ?? e).slice(0, 300)}`);
  }
}
prog.done(`all done · ${done} companies · ${rowsTotal} facts · ${failed} failed`);
if (failed > 0) process.exitCode = 1;
