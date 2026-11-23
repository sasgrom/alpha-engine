/**
 * Two independent checks of the adjusted earnings per share read by scripts/build-adjusted-eps.mts. Read-only.
 *
 * 1. The release's own words. For a sample of the usable figures, the exhibits' running text (not the tables) is
 *    searched for the figure, printed to the cent, in a sentence that also says adjusted / non-GAAP / core and names
 *    a per-share figure. A release need not say it in words, so "not found" is not an error; "found" confirms the
 *    number and its meaning by a route that does not go through the table reader.
 * 2. The company's guidance. Where the guidance standard holds adjusted per-share guidance for the quarter, given
 *    before the release, the figure is set against the guided midpoint. Companies land near their guidance; a
 *    figure far off is another measure or a misread.
 *
 *   npx tsx scripts/check-adjusted-eps.mts [--dir <adjusted-eps build folder>] [--guidance <guidance build folder>] [--sample 600]
 * Writes checks.json into the build folder.
 */
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { ADJUSTED_EPS_VERSION, type DecidedRelease } from "../worker/lib/adjusted-eps";
import { htmlToParagraphs } from "../worker/lib/desk-company";
import { writeJsonAtomic } from "../worker/lib/json-file";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const dir = path.resolve(arg("--dir") ?? `D:/research/alpha-engine/engine/adjusted-eps/${ADJUSTED_EPS_VERSION}`);
const guidanceDir = path.resolve(arg("--guidance") ?? "D:/research/alpha-engine/guidance/std/20261123T033803Z");
const sample = Number(arg("--sample") ?? 600);
const cache = path.resolve("worker/cache/edgar");
type Figure = DecidedRelease & { cik: number; ticker: string };
const figures = readFileSync(path.join(dir, "figures.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Figure);
const usable = figures.filter((row) => row.quarter && (row.quarter.grade === "confirmed" || row.quarter.grade === "same_row"));

// ---- 1. the release's own words ----
const ADJUSTED = /\b(adjusted|non[- ]?gaap|core|operating|normalized|comparable|underlying|ongoing|excluding)\b/i;
const PER_SHARE = /\bE\.?P\.?S\.?\b|per (?:diluted |common )*share|a share/i;
// a deterministic sample: every k-th usable figure in file order
const step = Math.max(1, Math.floor(usable.length / sample));
const picked = usable.filter((_, index) => index % step === 0).slice(0, sample);
let found = 0, noText = 0;
const byGrade: Record<string, { checked: number; found: number }> = {};
const notFound: Array<Record<string, unknown>> = [];
for (const row of picked) {
  const directory = path.join(cache, String(row.cik)), stem = row.accession.replaceAll("-", "");
  const names = existsSync(directory) ? readdirSync(directory).filter((name) => name.startsWith(`${stem}.ex`) && /\.html?$/.test(name)) : [];
  const sentences = names.flatMap((name) => htmlToParagraphs(readFileSync(path.join(directory, name), "utf8"), 4000).paragraphs).filter((paragraph) => !paragraph.includes(" | ") && paragraph.length > 40);
  const value = Math.abs(row.quarter!.value).toFixed(2);
  const number = new RegExp(`(?<![\\d.])\\$?\\s?\\(?${value.replace(".", "\\.")}\\)?(?![\\d])`);
  const said = sentences.some((sentence) => number.test(sentence) && ADJUSTED.test(sentence) && PER_SHARE.test(sentence));
  const grade = (byGrade[row.quarter!.grade] ??= { checked: 0, found: 0 });
  grade.checked++;
  if (!sentences.length) noText++;
  if (said) { found++; grade.found++; }
  else if (notFound.length < 200) notFound.push({ ticker: row.ticker, accession: row.accession, periodEnd: row.fiscalPeriodEnd, value: row.quarter!.value, grade: row.quarter!.grade, label: row.quarter!.label });
}

// ---- 2. against the company's adjusted guidance ----
const guided = new Map<string, Array<{ issued: string; mid: number; low: number | null; high: number | null }>>();
const BAD = new Set(["metric_conflict", "metric_unconfirmed", "unit_mismatch", "low_above_high"]);
for await (const line of createInterface({ input: createReadStream(path.join(guidanceDir, "statements.jsonl"), "utf8"), crlfDelay: Infinity })) {
  if (!line) continue;
  const s = JSON.parse(line);
  if (s.metric !== "eps" || s.basis !== "non_gaap" || s.periodKind !== "Q" || s.timing !== "forward" || s.duplicateOf || !s.periodEnd || s.unit !== "usd_per_share" || !Number.isFinite(s.mid) || s.flags.some((flag: string) => BAD.has(flag))) continue;
  const key = String(s.cik);
  guided.set(key, [...(guided.get(key) ?? []), { issued: s.acceptedEt, mid: s.mid, low: s.low, high: s.high, periodEnd: s.periodEnd } as never]);
}
const DAY = 86_400_000;
const surprises: number[] = [];
let inRange = 0, withRange = 0;
const far: Array<Record<string, unknown>> = [];
for (const row of usable) {
  const list = (guided.get(String(row.cik)) ?? []) as Array<{ issued: string; mid: number; low: number | null; high: number | null; periodEnd: string }>;
  const before = list.filter((item) => Math.abs(Date.parse(item.periodEnd) - Date.parse(row.fiscalPeriodEnd)) <= 10 * DAY && item.issued < row.acceptedEt && Date.parse(row.acceptedEt) - Date.parse(item.issued) < 200 * DAY).sort((a, b) => a.issued.localeCompare(b.issued));
  const last = before.at(-1);
  if (!last || last.mid === 0) continue;
  const surprise = (row.quarter!.value - last.mid) / Math.abs(last.mid);
  surprises.push(surprise);
  if (last.low !== null && last.high !== null && last.low !== last.high) { withRange++; if (row.quarter!.value >= last.low - 0.005 && row.quarter!.value <= last.high + 0.005) inRange++; }
  if (Math.abs(surprise) > 0.5 && far.length < 300) far.push({ ticker: row.ticker, accession: row.accession, periodEnd: row.fiscalPeriodEnd, value: row.quarter!.value, guidedMid: last.mid, label: row.quarter!.label, grade: row.quarter!.grade });
}
surprises.sort((a, b) => a - b);
const at = (p: number) => (surprises.length ? Math.round(surprises[Math.floor(p * (surprises.length - 1))] * 1e4) / 1e4 : null);
const share = (test: (value: number) => boolean) => (surprises.length ? Math.round((1000 * surprises.filter(test).length) / surprises.length) / 10 : null);
const checks = {
  version: ADJUSTED_EPS_VERSION, generatedAt: new Date().toISOString(), usableQuarterFigures: usable.length,
  ownWords: { sampled: picked.length, found, foundPct: Math.round((1000 * found) / Math.max(1, picked.length)) / 10, withoutRunningText: noText, byGrade, notFound },
  againstGuidance: {
    pairs: surprises.length, median: at(0.5), p10: at(0.1), p90: at(0.9), withinTenPercentPct: share((value) => Math.abs(value) <= 0.1), aboveMidPct: share((value) => value > 0),
    fartherThanHalfPct: share((value) => Math.abs(value) > 0.5), inOrAtRangePct: withRange ? Math.round((1000 * inRange) / withRange) / 10 : null, withRange, far,
  },
};
writeJsonAtomic(path.join(dir, "checks.json"), checks, true);
console.log(`[check-adjusted-eps] ${usable.length} usable quarter figures · own words: ${found} of ${picked.length} sampled say the figure (${checks.ownWords.foundPct}%) ${JSON.stringify(byGrade)} · against guidance: ${surprises.length} pairs, median ${at(0.5)}, 10th to 90th percentile ${at(0.1)} to ${at(0.9)}, within 10% of the midpoint ${checks.againstGuidance.withinTenPercentPct}%, farther than half ${checks.againstGuidance.fartherThanHalfPct}%`);
