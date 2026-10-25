/**
 * 5g — build the top-300 13F fund universe by reported AUM (self-maintaining).
 *   npx tsx scripts/build-13f-top300.mts [--top 300] [--days 120]
 *
 * How: enumerate ALL 13F-HR filers over the recent window via EDGAR full-text
 * search → per filer merge the latest quarter's original + semantic amendments
 * → sum value → rank → write worker/funds-13f-top300.json. Curated funds (funds-13f.json)
 * keep their tiers (activist/quant/fundamental/passive); the rest are marked
 * "institutional" — holdings are stored for them, events are NOT generated
 * (see 13f-refresh SIGNAL_TIERS).
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { listFilingDocs, fetchDoc, secGet } from "../worker/lib/edgar";
import { parseInfoTable, loadFundUniverse, autoScale13F, amendmentKindFromPrimary, mergeQuarterFilings, type QuarterFilingPart } from "../worker/lib/thirteenf";
import { startProgress } from "../worker/lib/progress";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const TOP = Number(arg("--top") ?? 300);
const DAYS = Number(arg("--days") ?? 120);
const FTS = "https://efts.sec.gov/LATEST/search-index";
const SEC_DATA = "https://data.sec.gov";
const prog = startProgress("13f-top300", `top=${TOP}, window=${DAYS}d`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ftsJson(url: string): Promise<any> {
  const res = await secGet(url);
  return res.json();
}

/** All distinct filer CIKs (+ display names) over the window. */
async function enumerateFilers(): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
  for (let from = 0; ; from += 100) {
    let hits: any[] = [];
    try {
      const j = await ftsJson(`${FTS}?forms=13F-HR&startdt=${start}&enddt=${end}&from=${from}&size=100`);
      hits = j?.hits?.hits ?? [];
    } catch { await sleep(3000); continue; }
    if (hits.length === 0) break;
    for (const h of hits) {
      const s = h._source ?? {};
      const names: string[] = s.display_names ?? [];
      for (const c of s.ciks ?? []) out.set(Number(c), names[0] ?? c);
    }
    if (from % 500 === 0) prog.log(`filers enumerated: ${out.size}`);
  }
  return out;
}

/** AUM from the latest quarter's COMPLETE book, including partial amendments. */
async function latestAum(cik: number): Promise<number | null> {
  const sub = await (await secGet(`${SEC_DATA}/submissions/CIK${String(cik).padStart(10, "0")}.json`)).json() as any;
  const r = sub?.filings?.recent;
  const filings: { accessionNo: string; form: string; filingDate: string; reportDate: string }[] = [];
  for (let i = 0; i < (r?.form?.length ?? 0); i++) {
    if (r.form[i] !== "13F-HR" && r.form[i] !== "13F-HR/A") continue;
    filings.push({
      accessionNo: String(r.accessionNumber[i]), form: String(r.form[i]),
      filingDate: String(r.filingDate[i]), reportDate: String(r.reportDate[i] || r.filingDate[i]),
    });
  }
  const latestQ = filings.map((f) => f.reportDate).sort().at(-1);
  if (!latestQ) return null;
  const parts: QuarterFilingPart[] = [];
  for (const f of filings.filter((x) => x.reportDate === latestQ)) {
    const primary = await fetchDoc(cik, f.accessionNo, "primary_doc.xml");
    const amendment = amendmentKindFromPrimary(primary, f.form);
    if (amendment === "UNKNOWN") throw new Error(`Unknown amendment type: ${f.accessionNo}`);
    const docs = (await listFilingDocs(cik, f.accessionNo)).filter((d) => /\.xml$/i.test(d.name));
    const biggest = docs.sort((a, b) => b.size - a.size)[0];
    if (!biggest) throw new Error(`No information table: ${f.accessionNo}`);
    const holdings = parseInfoTable(await fetchDoc(cik, f.accessionNo, biggest.name));
    autoScale13F(holdings); // dollar-vs-thousands calibration per filing
    parts.push({ ...f, amendment, holdings });
  }
  return mergeQuarterFilings(parts).holdings.reduce((a, h) => a + (h.valueUsd ?? 0), 0);
}

const filers = await enumerateFilers();
prog.log(`filers: ${filers.size}; ranking AUM…`);
const curated = new Map(loadFundUniverse().map((f) => [f.cik, f.tier]));
const ranked: { cik: number; name: string; aum: number }[] = [];
let done = 0;
for (const [cik, name] of filers) {
  try {
    const aum = await latestAum(cik);
    if (aum && aum > 0) ranked.push({ cik, name, aum });
  } catch { /* single-filer failure must not stop the ranking */ }
  if (++done % 100 === 0) prog.item(done, filers.size, `${ranked.length} with AUM`);
}
ranked.sort((a, b) => b.aum - a.aum);
const top = ranked.slice(0, TOP).map((f) => ({
  cik: f.cik,
  name: f.name.replace(/\s*\(CIK\s*0*\d+\)\s*$/i, "").replace(/\s+/g, " ").slice(0, 80),
  tier: curated.get(f.cik) ?? "institutional",
  aumUsd: f.aum,
}));
const file = path.resolve(import.meta.dirname, "..", "worker", "funds-13f-top300.json");
writeFileSync(file, JSON.stringify(top, null, 1) + "\n");
prog.done(`funds-13f-top300.json: ${top.length} funds; total AUM $${(top.reduce((a, f) => a + f.aumUsd, 0) / 1e12).toFixed(1)}T; #1 ${top[0]?.name} $${((top[0]?.aumUsd ?? 0) / 1e12).toFixed(2)}T`);
process.exit(0);
