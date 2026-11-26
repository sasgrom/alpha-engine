/**
 * The activists of the money map (owner, 2026-11-26: "go ahead with the activists"): Schedule 13D stakes in our
 * companies, read from the filings the nightly SEC fetch caches (worker/cache/edgar/<cik>/), no new download.
 *
 *   npx tsx scripts/build-flow-activists.mts [--from 2019-07-01]
 *
 * A filing sits in the folder of every company it concerns, filer or subject: the subject is decided by the cover page's
 * CUSIP (the issuer's six characters, from the CUSIP map of index-membership), else by the issuer's name on the cover
 * against the folder's company. Each accession is counted once. The stake is the largest share count and percent any
 * cover page of the group states. Against the same filer's previous filing on that company a stake is new, raised, cut
 * (by a tenth of a point or more), held, or exited (below 5%). Output worker/.runs/desk-flows/activists.json.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../worker/lib/json-file";
import { filerKey, parse13D, stakeOf } from "../worker/lib/schedule-13d";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const from = arg("--from") ?? "2019-07-01";
const CACHE = path.resolve("worker/cache/edgar");
const FORMS = new Set(["SC 13D", "SC 13D/A", "SCHEDULE 13D", "SCHEDULE 13D/A"]);

const overview = JSON.parse(readFileSync("worker/.runs/desk-flows/overview.json", "utf8")) as { companies: { cik: number; ticker: string; name: string }[] };
const company = new Map(overview.companies.map((entry) => [entry.cik, entry]));
const cusipMap = JSON.parse(readFileSync("D:/research/alpha-engine/index-membership/cusip-company-map.json", "utf8")) as { cusip: string; cik: number }[];
const byIssuer = new Map<string, Set<number>>();
for (const row of cusipMap) {
  const key = row.cusip.slice(0, 6).toUpperCase();
  byIssuer.set(key, (byIssuer.get(key) ?? new Set()).add(row.cik));
}
const nameWords = (name: string) => name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word && !["inc", "corp", "corporation", "co", "company", "the", "ltd", "plc", "holdings", "group", "class", "common", "stock"].includes(word));
const sameName = (a: string, b: string) => { const x = nameWords(a), y = nameWords(b); return x.length > 0 && y.length > 0 && x.slice(0, 2).join(" ") === y.slice(0, 2).join(" "); };

interface Stake { accession: string; filed: string; form: string; cik: number; lead: string; key: string; shares: number | null; percent: number | null; how: "cusip" | "name" }
const stakes: Stake[] = [];
const seen = new Set<string>();
const counts = { filings: 0, read: 0, noFile: 0, notOurs: 0, noPercent: 0, byCusip: 0, byName: 0 };
for (const folder of readdirSync(CACHE).filter((name) => /^\d+$/.test(name))) {
  const manifestFile = path.join(CACHE, folder, "manifest.json");
  if (!existsSync(manifestFile)) continue;
  let manifest: { accessionNo: string; form: string; filingDate: string }[];
  try { manifest = JSON.parse(readFileSync(manifestFile, "utf8")); } catch { continue; }
  for (const entry of manifest) {
    const form = (entry.form ?? "").toUpperCase();
    if (!FORMS.has(form) || (entry.filingDate ?? "") < from || seen.has(entry.accessionNo)) continue;
    counts.filings++;
    const file = path.join(CACHE, folder, `${entry.accessionNo.replace(/-/g, "")}.htm`);
    if (!existsSync(file)) { counts.noFile++; continue; }
    const filing = parse13D(readFileSync(file, "utf8"));
    counts.read++;
    const issuerCiks = filing.cusip ? byIssuer.get(filing.cusip.slice(0, 6)) : undefined;
    let cik: number | null = null, how: Stake["how"] = "cusip";
    if (issuerCiks && issuerCiks.size === 1) cik = [...issuerCiks][0];
    else if (filing.issuer && company.has(Number(folder)) && sameName(filing.issuer, company.get(Number(folder))!.name)) { cik = Number(folder); how = "name"; }
    if (cik === null || !company.has(cik)) { counts.notOurs++; continue; }
    seen.add(entry.accessionNo);
    const stake = stakeOf(filing);
    if (!stake.lead) { counts.notOurs++; continue; }
    if (stake.percent === null) counts.noPercent++;
    if (how === "cusip") counts.byCusip++; else counts.byName++;
    stakes.push({ accession: entry.accessionNo, filed: entry.filingDate, form, cik, lead: stake.lead, key: filerKey(stake.lead), shares: stake.shares, percent: stake.percent, how });
  }
}

stakes.sort((a, b) => a.filed.localeCompare(b.filed) || a.accession.localeCompare(b.accession));
const quarterEnd = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  const q = Math.ceil(m / 3) * 3;
  return `${y}-${String(q).padStart(2, "0")}-${q === 6 || q === 9 ? "30" : "31"}`;
};
type Row = { how: Stake["how"]; filer: string; key: string; cik: number; percent: number | null; previous: number | null; shares: number | null; kind: "new" | "raised" | "cut" | "held" | "exited"; filed: string; filings: number };
const last = new Map<string, number | null>();
const byQuarter = new Map<string, Map<string, Row>>();
for (const stake of stakes) {
  const pair = `${stake.key}|${stake.cik}`;
  const known = last.has(pair);
  const previous = last.get(pair) ?? null;
  const kind: Row["kind"] = stake.percent !== null && stake.percent < 5 ? "exited" : !known ? "new"
    : previous === null || stake.percent === null ? "held" : stake.percent - previous >= 0.1 ? "raised" : previous - stake.percent >= 0.1 ? "cut" : "held";
  last.set(pair, stake.percent);
  const quarter = quarterEnd(stake.filed);
  const rows = byQuarter.get(quarter) ?? new Map<string, Row>();
  byQuarter.set(quarter, rows);
  const earlier = rows.get(pair);
  // the quarter keeps the latest filing of a pair, and the change from before the quarter
  rows.set(pair, { how: stake.how, filer: stake.lead, key: stake.key, cik: stake.cik, percent: stake.percent, previous: earlier ? earlier.previous : previous, shares: stake.shares, kind: earlier && earlier.kind === "new" && kind !== "exited" ? "new" : kind, filed: stake.filed, filings: (earlier?.filings ?? 0) + 1 });
}
const quarters: Record<string, Row[]> = {};
for (const [quarter, rows] of [...byQuarter].sort()) quarters[quarter] = [...rows.values()].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
const out = path.resolve("worker/.runs/desk-flows/activists.json");
writeJsonAtomic(out, { schemaVersion: 1, builtAt: new Date().toISOString(), from, counts, stakes: stakes.length, quarters });
console.log(`activists: ${JSON.stringify(counts)} · ${stakes.length} stakes in our companies · ${Object.keys(quarters).length} quarters -> ${out}`);
