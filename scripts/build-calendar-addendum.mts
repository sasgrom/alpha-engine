/**
 * The release calendar's addendum: the filings and quarters since the pinned calendar was built, from the nightly SEC
 * cache, in the calendar's own shape (worker/lib/calendar-addendum.ts). Rebuilt whole on every run; the pinned
 * calendar files are read only.
 *
 *   npx tsx scripts/build-calendar-addendum.mts [--calendar <release calendar folder>] [--cache <SEC cache folder>] [--dry-run]
 *
 * Output: <calendar>/addendum/filings-new.jsonl, quarters-new.jsonl and manifest.json (counts, hashes, the releases it
 * could not place, and how the period-end rule did on the calendar's own consecutive quarters).
 * A missing calendar or cache folder stops the run (the D: drive may be away): nothing is created in its place.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { buildCompanyAddendum, periodEndAccuracy, type AddendumQuarter, type CachedManifestFiling } from "../worker/lib/calendar-addendum";
import type { CalendarFiling } from "../worker/lib/event-calendar";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const calendarDir = path.resolve(arg("--calendar") ?? "D:/research/alpha-engine/engine/events");
const cacheDir = path.resolve(arg("--cache") ?? "worker/cache/edgar");
const dryRun = process.argv.includes("--dry-run");
const SETS = ["50", "rest", "six"];
if (!existsSync(calendarDir) || !existsSync(cacheDir)) throw new Error(`The release calendar (${calendarDir}) or the SEC cache (${cacheDir}) is not there; nothing was written`);
if (!arg("--calendar") && !/^d:/i.test(realpathSync(calendarDir))) throw new Error("The release calendar must resolve to D:");

async function lines<T>(file: string, each: (row: T) => void): Promise<void> {
  for await (const line of createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity })) if (line) each(JSON.parse(line) as T);
}

const pinnedFilings = new Map<number, CalendarFiling[]>(), pinnedEnds = new Map<number, string[]>(), asOfByCompany = new Map<number, string>(), tickers = new Map<number, string>();
const allPinnedQuarters: { cik: number; fiscalPeriodEnd: string }[] = [];
for (const set of SETS) {
  const filingsFile = path.join(calendarDir, `filings-${set}.jsonl`), quartersFile = path.join(calendarDir, `quarters-${set}.jsonl`);
  if (!existsSync(filingsFile) || !existsSync(quartersFile)) { if (set === "six") continue; throw new Error(`${filingsFile} or its quarters file is missing; nothing was written`); }
  let asOf = "";
  const ciks = new Set<number>();
  await lines<CalendarFiling>(filingsFile, (row) => {
    // the builder needs each filing's identity, dates, form and earnings flag; the cached-file lists are not carried
    pinnedFilings.set(row.cik, [...(pinnedFilings.get(row.cik) ?? []), { ...row, cachedFiles: [] }]);
    tickers.set(row.cik, row.ticker);
    ciks.add(row.cik);
    if (row.filingDate > asOf) asOf = row.filingDate;
  });
  for (const cik of ciks) asOfByCompany.set(cik, asOf);
  await lines<{ cik: number; fiscalPeriodEnd: string }>(quartersFile, (row) => {
    pinnedEnds.set(row.cik, [...(pinnedEnds.get(row.cik) ?? []), row.fiscalPeriodEnd]);
    allPinnedQuarters.push({ cik: row.cik, fiscalPeriodEnd: row.fiscalPeriodEnd });
  });
}

const filings: CalendarFiling[] = [], quarters: AddendumQuarter[] = [], unplaced: Array<{ cik: number; ticker: string; accessionNo: string; acceptedEt: string | null; reason: string }> = [];
let withoutManifest = 0, withoutTimes = 0;
for (const [cik, rows] of [...pinnedFilings].sort((a, b) => a[0] - b[0])) {
  const manifestFile = path.join(cacheDir, String(cik), "manifest.json");
  if (!existsSync(manifestFile)) { withoutManifest++; continue; }
  const cached = JSON.parse(readFileSync(manifestFile, "utf8")) as CachedManifestFiling[];
  const addendum = buildCompanyAddendum({ company: { cik, ticker: tickers.get(cik)! }, pinnedFilings: rows, pinnedQuarterEnds: pinnedEnds.get(cik) ?? [], cached, calendarAsOf: asOfByCompany.get(cik)! });
  withoutTimes += addendum.filings.filter((row) => row.acceptedEt === null).length;
  filings.push(...addendum.filings);
  quarters.push(...addendum.quarters);
  unplaced.push(...addendum.unplaced.map((row) => ({ cik, ticker: tickers.get(cik)!, ...row })));
}

const jsonl = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const filingsText = jsonl(filings), quartersText = jsonl(quarters);
const accuracy = periodEndAccuracy(allPinnedQuarters);
const releases = new Set(quarters.flatMap((quarter) => quarter.earningsFilings.map((filing) => filing.accessionNo)));
const manifest = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), calendarDir: calendarDir.replaceAll("\\", "/"),
  counts: {
    companies: pinnedFilings.size, companiesWithoutManifest: withoutManifest, filings: filings.length, filingsWithoutAcceptanceTime: withoutTimes,
    quarters: quarters.length, paired: quarters.filter((quarter) => quarter.pairingBasis === "earnings_8k").length, periodicOnly: quarters.filter((quarter) => quarter.pairingBasis === "periodic_only").length,
    inferred: quarters.filter((quarter) => quarter.pairingBasis === "earnings_8k_inferred").length, releases: releases.size, unplaced: unplaced.length,
  },
  newestFiling: filings.map((row) => row.filingDate).sort().at(-1) ?? null,
  periodEndRule: { ...accuracy, exactShare: accuracy.pairs ? Number((accuracy.exact / accuracy.pairs).toFixed(4)) : null, withinWeekShare: accuracy.pairs ? Number((accuracy.withinWeek / accuracy.pairs).toFixed(4)) : null, measuredOn: "consecutive quarters of the pinned calendar" },
  artifacts: { "filings-new.jsonl": sha(filingsText), "quarters-new.jsonl": sha(quartersText) },
  unplaced,
};
if (!dryRun) {
  const out = path.join(calendarDir, "addendum");
  mkdirSync(out, { recursive: true });
  // the two lists first, the manifest last: a reader checks the lists against the manifest's hashes
  for (const [name, text] of [["filings-new.jsonl", filingsText], ["quarters-new.jsonl", quartersText]] as const) { writeFileSync(path.join(out, `${name}.tmp`), text); renameSync(path.join(out, `${name}.tmp`), path.join(out, name)); }
  writeJsonAtomic(path.join(out, "manifest.json"), manifest, true);
}
console.log(`[calendar-addendum] ${dryRun ? "dry run · " : ""}${manifest.counts.filings} filings since the calendar (to ${manifest.newestFiling}) · quarters ${manifest.counts.quarters}: ${manifest.counts.paired} paired, ${manifest.counts.inferred} inferred, ${manifest.counts.periodicOnly} without a release · ${manifest.counts.releases} releases · ${manifest.counts.unplaced} unplaced · ${withoutTimes} filings without an acceptance time · period-end rule exact ${manifest.periodEndRule.exactShare}, within a week ${manifest.periodEndRule.withinWeekShare} of ${accuracy.pairs} · ${calendarDir}`);
