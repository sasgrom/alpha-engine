import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
/** Incremental SEC companyfacts collection: local raw cache → local factsSnapshot ingest.
 * Use --cached only for an offline manifest/raw recovery, never for a network skip.
 */
import "dotenv/config";
import { loadEdgarUniverse } from "./lib/edgar";
import { assertLocalFactsIngestUrl, dedupeFactsUniverse, runFactsCollection } from "./lib/facts-incremental";
import { startProgress } from "./lib/progress";

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;
const universeIdx = process.argv.indexOf("--universe");
const universeFile = universeIdx > -1 ? process.argv[universeIdx + 1] : "edgar-universe-35.json";
const useCached = process.argv.includes("--cached");
const universe = dedupeFactsUniverse(loadEdgarUniverse(universeFile)).filter((company) => !only || company.ticker === only);
if (only && universe.length === 0) { console.error(`[facts-fetch] unknown ticker ${only}`); process.exit(1); }
const ingestUrl = process.env.INGEST_URL ?? "http://127.0.0.1:3000/api/worker/ingest";
assertLocalFactsIngestUrl(ingestUrl);

const prog = startProgress("facts-fetch", `${universe.length} unique CIKs · local ingest · ${useCached ? "cached recovery" : "incremental SEC"}`);
const summary = await runFactsCollection(universe, { ingestUrl, useCached });
for (const [index, result] of summary.results.entries()) {
  prog.item(index + 1, summary.checked, `${result.ticker} ${result.status} · ${result.rows} facts · ${result.reason}${result.error ? ` · ${result.error}` : ""}`);
}
prog.done(`all done · checked ${summary.checked} · refreshed ${summary.refreshed} · unchanged ${summary.unchanged} · failed ${summary.failed} · ${summary.rowsTotal} facts`);
if (summary.failed > 0) process.exitCode = 1;
