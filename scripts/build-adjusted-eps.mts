/**
 * Reads the adjusted (non-GAAP) earnings per share that each earnings release prints, from the cached exhibits
 * (worker/cache/edgar/<cik>/<accession>.ex*.htm), with worker/lib/adjusted-eps.ts. Read-only on the cache, on the
 * guidance standard (whose release list names every release with its fiscal period end), on the standard fundamentals
 * (the GAAP earnings per diluted share of each quarter, which settle the period columns) and on the standard prices
 * (splits); no network, no database.
 *
 *   npx tsx scripts/build-adjusted-eps.mts [--releases <guidance build folder>] [--prices <standard prices daily folder>]
 *                                          [--fundamentals <fundamentals standard folder>] [--out <folder>] [--since YYYY-MM-DD] [--ciks a,b] [--limit N] [--force]
 *
 * Output (default D:/research/alpha-engine/engine/adjusted-eps/<reader version>):
 *   readings/<cik>.jsonl  step 1, the slow one: per release, every adjusted per-share row its tables print, for every
 *                         period column. Written atomically per company and reused while the code hash is the same
 *                         (--force rereads), so a stopped run resumes.
 *   figures.jsonl         step 2: per release the quarter's and the fiscal year's figure with its grade (confirmed by
 *                         a later release, same row as confirmed quarters, restated, unchecked) and where it was read
 *   summary.json          counts by grade, and the restated and ambiguous cases
 * A missing cache folder or release list stops the run and changes nothing.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { ADJUSTED_EPS_VERSION, adjustedEpsFromExhibits, decideCompany, type DecidedRelease, type EpsAnchor, type StoredRelease } from "../worker/lib/adjusted-eps";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const releasesDir = path.resolve(arg("--releases") ?? "D:/research/alpha-engine/guidance/std/20261123T033803Z");
const pricesDir = path.resolve(arg("--prices") ?? "D:/research/alpha-engine/prices/std/daily");
const fundamentalsDir = path.resolve(arg("--fundamentals") ?? "D:/research/alpha-engine/fundamentals/standard/v3.1");
const out = path.resolve(arg("--out") ?? `D:/research/alpha-engine/engine/adjusted-eps/${ADJUSTED_EPS_VERSION}`);
const cache = path.resolve("worker/cache/edgar");
const since = arg("--since") ?? "0000-00-00";
const only = arg("--ciks") ? new Set(arg("--ciks")!.split(",").map(Number)) : null;
const limit = arg("--limit") ? Number(arg("--limit")) : Infinity;
const force = process.argv.includes("--force");
const releasesFile = path.join(releasesDir, "releases.jsonl");
if (!existsSync(releasesFile)) throw new Error(`Release list not found at ${releasesFile}; nothing was changed`);
if (!existsSync(cache)) throw new Error(`Exhibit cache not found at ${cache}; nothing was changed`);
if (!existsSync(pricesDir)) throw new Error(`Standard prices not found at ${pricesDir}; nothing was changed`);
if (!existsSync(path.join(fundamentalsDir, "company"))) throw new Error(`Standard fundamentals not found at ${fundamentalsDir}; nothing was changed`);
// the reading depends on the table parser too; the deciding rules are cheap and rerun every time
const readerHash = createHash("sha256").update(path.basename(fundamentalsDir)).update(readFileSync("worker/lib/flash-html.ts")).update(readFileSync("worker/lib/adjusted-eps.ts", "utf8").split("// --- deciding per company")[0]).digest("hex").slice(0, 16);

interface Release { cik: number; ticker: string; accessionNo: string; acceptedEt: string; fiscalPeriodEnd: string | null }
interface StoredLine extends StoredRelease { readerHash: string; cik: number; ticker: string; exhibits: number }

const byCompany = new Map<number, Map<string, Release>>();
for await (const line of createInterface({ input: createReadStream(releasesFile, "utf8"), crlfDelay: Infinity })) {
  if (!line) continue;
  const row = JSON.parse(line) as Release;
  if (!row.fiscalPeriodEnd || row.acceptedEt < since || (only && !only.has(row.cik))) continue;
  const company = byCompany.get(row.cik) ?? byCompany.set(row.cik, new Map()).get(row.cik)!;
  if (!company.has(row.accessionNo)) company.set(row.accessionNo, row);
}

function splitsOf(cik: number): Array<{ date: string; ratio: number }> {
  const file = path.join(pricesDir, `${cik}.csv`);
  if (!existsSync(file)) return [];
  const [header, ...lines] = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const names = header.split(","), date = names.indexOf("date"), ratio = names.indexOf("splitRatio");
  return lines.map((line) => line.split(",")).filter((cells) => cells[ratio] && Number(cells[ratio]) > 0 && Number(cells[ratio]) !== 1).map((cells) => ({ date: cells[date], ratio: Number(cells[ratio]) }));
}

const DAY = 86_400_000;
/**
 * The GAAP earnings per diluted share known for a release's quarter and for the quarter a year before: every figure
 * the filed statements carry for that quarter (first report and later versions), and the first report moved across
 * the splits up to the release (a release prints the year-ago quarter on its own share basis).
 */
function anchorsOf(cik: number, splits: Array<{ date: string; ratio: number }>): (periodEnd: string, acceptedEt: string) => EpsAnchor[] {
  const file = path.join(fundamentalsDir, "company", `${cik}.json`);
  if (!existsSync(file)) return () => [];
  const doc = JSON.parse(readFileSync(file, "utf8")) as { quarters: Array<{ end: string }>; fields: Record<string, Array<[number, Array<[string, number]>]>> };
  const versions = new Map((doc.fields.epsDil ?? []).map(([index, list]) => [index, [...list].sort((a, b) => a[0].localeCompare(b[0]))]));
  const nearest = (end: string) => {
    let best = -1;
    doc.quarters.forEach((quarter, index) => { if (Math.abs(Date.parse(quarter.end) - Date.parse(end)) <= 10 * DAY && versions.has(index) && (best < 0 || Math.abs(Date.parse(quarter.end) - Date.parse(end)) < Math.abs(Date.parse(doc.quarters[best].end) - Date.parse(end)))) best = index; });
    return best;
  };
  return (periodEnd, acceptedEt) => {
    const anchors: EpsAnchor[] = [];
    const yearAgo = new Date(Date.parse(periodEnd) - 365 * DAY).toISOString().slice(0, 10);
    for (const end of [periodEnd, yearAgo]) {
      const index = nearest(end);
      if (index < 0) continue;
      const list = versions.get(index)!;
      const factor = splits.filter((split) => split.date > list[0][0] && split.date <= acceptedEt.slice(0, 10)).reduce((product, split) => product * split.ratio, 1);
      const gaap = [...new Set([...list.map((version) => version[1]), list[0][1] / factor].filter((value) => Number.isFinite(value) && Math.abs(value) < 500).map((value) => Math.round(value * 1e4) / 1e4))];
      if (gaap.length) anchors.push({ months: 3, periodEnd: end === periodEnd ? periodEnd : doc.quarters[index].end, gaap });
    }
    return anchors;
  };
}

mkdirSync(path.join(out, "readings"), { recursive: true });
const started = Date.now();
let companies = 0, releases = 0, reused = 0;
const figures: Array<DecidedRelease & { cik: number; ticker: string }> = [];
for (const [cik, list] of [...byCompany].sort((a, b) => a[0] - b[0])) {
  if (companies >= limit) break;
  companies++;
  const file = path.join(out, "readings", `${cik}.jsonl`);
  let stored: StoredLine[] | null = null;
  if (!force && existsSync(file)) {
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as StoredLine);
    if (lines.every((line) => line.readerHash === readerHash) && lines.length === list.size) { stored = lines; reused++; }
  }
  if (!stored) {
    const directory = path.join(cache, String(cik));
    const names = existsSync(directory) ? readdirSync(directory) : [];
    const anchors = anchorsOf(cik, splitsOf(cik));
    stored = [];
    for (const release of [...list.values()].sort((a, b) => a.acceptedEt.localeCompare(b.acceptedEt))) {
      const stem = release.accessionNo.replaceAll("-", "");
      const exhibits = names.filter((name) => name.startsWith(`${stem}.ex`) && /\.html?$/.test(name)).sort().map((name) => {
        const html = readFileSync(path.join(directory, name), "utf8");
        return { file: name, sha256: createHash("sha256").update(html).digest("hex"), html };
      });
      const result = adjustedEpsFromExhibits(exhibits, release.fiscalPeriodEnd!, anchors(release.fiscalPeriodEnd!, release.acceptedEt));
      stored.push({
        readerHash, cik, ticker: release.ticker, accession: release.accessionNo, acceptedEt: release.acceptedEt, fiscalPeriodEnd: release.fiscalPeriodEnd!, exhibits: exhibits.length,
        readings: result.readings.map((reading) => ({ months: reading.months, periodEnd: reading.periodEnd, value: reading.value, diluted: reading.diluted, basic: reading.basic, label: reading.label, file: reading.file, tableIndex: reading.tableIndex, rowIndex: reading.rowIndex, how: reading.how })),
      });
    }
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, stored.map((row) => JSON.stringify(row)).join("\n") + (stored.length ? "\n" : ""));
    renameSync(temporary, file);
  }
  releases += stored.length;
  const ticker = stored[0]?.ticker ?? String(cik);
  for (const decided of decideCompany(stored, splitsOf(cik))) figures.push({ cik, ticker, ...decided });
  if (companies % 25 === 0) console.log(`[adjusted-eps] ${companies} companies, ${releases} releases, ${Math.round((Date.now() - started) / 1000)} s`);
}

const temporary = path.join(out, `figures.jsonl.${process.pid}.tmp`);
writeFileSync(temporary, figures.map((row) => JSON.stringify(row)).join("\n") + "\n");
renameSync(temporary, path.join(out, "figures.jsonl"));
const grades = (pick: (row: DecidedRelease) => DecidedRelease["quarter"]) => {
  const counts: Record<string, number> = { confirmed: 0, same_row: 0, restated: 0, unchecked: 0 };
  for (const row of figures) { const figure = pick(row); if (figure) counts[figure.grade]++; }
  return counts;
};
const usable = (row: DecidedRelease) => row.quarter !== null && (row.quarter.grade === "confirmed" || row.quarter.grade === "same_row");
const summary = {
  version: ADJUSTED_EPS_VERSION, readerHash, generatedAt: new Date().toISOString(), releasesDir, companies, releases, reusedCompanies: reused,
  quarter: grades((row) => row.quarter), year: grades((row) => row.year),
  ambiguousQuarter: figures.filter((row) => row.quarterNote === "ambiguous").length,
  companiesWithUsableQuarters: new Set(figures.filter(usable).map((row) => row.cik)).size,
  restated: figures.filter((row) => row.quarter?.grade === "restated").slice(0, 4000).map((row) => ({ ticker: row.ticker, cik: row.cik, accession: row.accession, periodEnd: row.fiscalPeriodEnd, value: row.quarter!.value, label: row.quarter!.label, later: row.quarter!.laterValues })),
};
writeJsonAtomic(path.join(out, "summary.json"), summary, true);
console.log(`[adjusted-eps] ${companies} companies (${reused} reused) · ${releases} releases · quarter figures: ${JSON.stringify(summary.quarter)} · fiscal years: ${JSON.stringify(summary.year)} · ambiguous ${summary.ambiguousQuarter} · companies with usable quarters ${summary.companiesWithUsableQuarters} · reader ${readerHash} · ${Math.round((Date.now() - started) / 1000)} s · ${out}`);
