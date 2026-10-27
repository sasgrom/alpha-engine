/**
 * Read-only EDGAR tone audit: no Ollama calls, no ingest, no manifest writes.
 * Scans pending cached documents with the exact production preparation path and
 * reports previous skips, deterministic skips, planned windows and prompt chars.
 * Run: npx tsx worker/edgar-tone-audit.mts [--manifest-only] [--only TICKER]
 */
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadEdgarUniverse, shouldScoreManifestEntry } from "./lib/edgar";
import { LLM_MODEL, NUM_CTX } from "./lib/ollama";
import { CACHE_SKIP, prepareToneFiling, THIN_SKIP } from "./lib/tone-prep";
import type { ManifestEntry } from "./edgar-fetch.mts";

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1]?.toUpperCase() : null;
const universeIdx = process.argv.indexOf("--universe");
const universeFile = universeIdx > -1 ? process.argv[universeIdx + 1] : "edgar-universe.json";
const fromIdx = process.argv.indexOf("--from");
const from = fromIdx > -1 ? process.argv[fromIdx + 1] : null;
const includeSkipped = process.argv.includes("--include-skipped");
const manifestOnly = process.argv.includes("--manifest-only");
const universe = loadEdgarUniverse(universeFile).filter((c) => !only || c.ticker === only);
if (only && universe.length === 0) { console.error(`[edgar-tone-audit] unknown ticker ${only}`); process.exit(1); }

const totals = {
  companies: 0, missingManifestCompanies: 0, filings: 0, fetched: 0, scored: 0,
  unfetched: 0, dead: 0, outboxAccessions: 0, pendingManifest: 0,
  ready: 0, thin: 0, unreadable: 0, plannedCalls: 0, plannedChars: 0,
};
const previousSkips = new Map<string, number>();
const forms = new Map<string, { ready: number; thin: number; calls: number; chars: number }>();
const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
const cacheDir = (cik: number) => path.resolve(import.meta.dirname, "cache", "edgar", String(cik));

for (const co of universe) {
  const companyDir = cacheDir(co.cik);
  let manifest: ManifestEntry[];
  try { manifest = JSON.parse(readFileSync(path.join(companyDir, "manifest.json"), "utf8")); }
  catch { totals.missingManifestCompanies++; continue; }
  totals.companies++;
  totals.filings += manifest.length;
  const outboxPath = path.join(companyDir, "outbox.json");
  let outbox = new Set<string>();
  if (existsSync(outboxPath)) {
    try {
      const box = JSON.parse(readFileSync(outboxPath, "utf8"));
      outbox = new Set<string>(box.accessions ?? []);
    } catch { /* audit leaves recovery to the scorer */ }
  }
  totals.outboxAccessions += outbox.size;
  const basePending = manifest.filter((m) => shouldScoreManifestEntry(m, from, includeSkipped, LLM_MODEL) && !outbox.has(m.accessionNo));
  totals.pendingManifest += basePending.length;
  let ready = 0, thin = 0, unreadable = 0, calls = 0, chars = 0;

  for (const m of manifest) {
    if (m.fetched) totals.fetched++; else totals.unfetched++;
    if (m.scored) totals.scored++;
    if (m.dead) totals.dead++;
    const dateEligible = !from || m.filingDate >= from;
    if (m.fetched && !m.scored && m.error && dateEligible && !outbox.has(m.accessionNo) &&
        !shouldScoreManifestEntry(m, from, includeSkipped, LLM_MODEL)) {
      bump(previousSkips, m.llmErrorCount && m.error === "no parseable score" ? `${m.error} (retry cap)` : m.error);
    }
  }
  if (!manifestOnly) for (const m of basePending) {
    const prep = prepareToneFiling(companyDir, m);
    const form = forms.get(m.form) ?? { ready: 0, thin: 0, calls: 0, chars: 0 };
    forms.set(m.form, form);
    if (!prep.ok) {
      if (prep.reason === THIN_SKIP) { thin++; form.thin++; }
      if (prep.reason === CACHE_SKIP) unreadable++;
      continue;
    }
    ready++;
    calls += prep.windows.length;
    chars += prep.chars;
    form.ready++;
    form.calls += prep.windows.length;
    form.chars += prep.chars;
  }
  totals.ready += ready;
  totals.thin += thin;
  totals.unreadable += unreadable;
  totals.plannedCalls += calls;
  totals.plannedChars += chars;
  console.log(`[edgar-tone-audit] ${co.ticker}: total ${manifest.length} · scored ${manifest.filter((m) => m.scored).length} · pending ${basePending.length} · ready ${ready} · thin ${thin} · unreadable ${unreadable} · planned calls ${calls}`);
}

const report = {
  readOnly: true, contentScanned: !manifestOnly, model: LLM_MODEL, numCtx: NUM_CTX,
  universe: universeFile, from, includeSkipped, ...totals,
  averagePromptChars: totals.plannedCalls ? Math.round(totals.plannedChars / totals.plannedCalls) : 0,
  previousSkips: Object.fromEntries([...previousSkips.entries()].sort((a, b) => b[1] - a[1])),
  forms: Object.fromEntries([...forms.entries()].sort()),
  note: "Planned calls follow deterministic preparation only; model-side boilerplate and parse outcomes require the real scorer. No files were changed.",
};
console.log("[edgar-tone-audit] SUMMARY\n" + JSON.stringify(report, null, 2));
