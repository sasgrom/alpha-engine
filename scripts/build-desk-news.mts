/**
 * The desk's news files from the news archive on D: (research input; no production write, no database).
 *
 *   npx tsx scripts/build-desk-news.mts [--days 30]
 *
 * worker/.runs/desk-news/days/<UTC date>.json   the stories first seen that day (copies joined, companies tied, the
 *                                               model's reading); today and yesterday are rebuilt every run, older
 *                                               days only when their file is missing (a copy seen two or more days
 *                                               after its story is not joined to it)
 * worker/.runs/desk-news/company/<cik>.json     every registry company's stories of the last --days days
 * The registry is the desk snapshot's companies. A missing archive stops the run and leaves the previous files.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { DESK_NEWS_SCHEMA_VERSION, type DeskNewsCompany, type DeskNewsDay, type DeskNewsStory } from "../contracts/desk-news";
import { buildStories, companyStories, type ArchiveItem, type ArchiveMention, type ArchiveReading } from "../worker/lib/desk-news";
import { writeJsonAtomic } from "../worker/lib/json-file";
import type { CompanyEntry } from "../worker/lib/news-companies";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const news = "D:/research/alpha-engine/news";
const out = path.resolve("worker/.runs/desk-news");
const days = Number(arg("--days") ?? 30);
if (!Number.isInteger(days) || days < 2 || days > 120) throw new Error("--days must be 2 to 120");
for (const dir of ["items", "lookup"]) if (!existsSync(path.join(news, dir))) throw new Error(`The news archive is not complete at ${news} (no ${dir}); nothing was written`);
if (!/^d:/i.test(realpathSync(news))) throw new Error("The news archive must resolve to D:");
const snapshotFile = path.resolve("public/reports/desk-snapshot.json");
if (!existsSync(snapshotFile)) throw new Error("No desk snapshot to take the registry from; nothing was written");

const started = Date.now();
const lines = (file: string) => existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
const parse = <T>(line: string): T | null => { try { return JSON.parse(line) as T; } catch { return null; } };   // a line cut by an interruption
const registry = new Set((JSON.parse(readFileSync(snapshotFile, "utf8")) as { companies: { cik: number }[] }).companies.map(company => company.cik));
const index = JSON.parse(readFileSync(path.join(news, "lookup", "company-index.json"), "utf8")) as { entries: CompanyEntry[] };
const companies = new Map(index.entries.map(entry => [entry.cik, entry]));
const tickerToCik = new Map<string, number>();
for (const entry of index.entries) for (const ticker of entry.tickers) if (!tickerToCik.has(ticker)) tickerToCik.set(ticker, entry.cik);

const today = new Date();
const dates = Array.from({ length: days }, (_, i) => new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10));
const dayFile = (date: string) => path.join(out, "days", `${date}.json`);
let rebuilt = 0;
for (const [i, date] of dates.entries()) {
  if (i >= 2 && existsSync(dayFile(date))) continue;
  if (!existsSync(path.join(news, "items", `${date}.jsonl`))) continue;
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const items: ArchiveItem[] = [];
  for (const day of [date, next]) for (const line of lines(path.join(news, "items", `${day}.jsonl`))) { const row = parse<ArchiveItem>(line); if (row) items.push(row); }
  const readings = new Map<string, ArchiveReading>();
  for (const line of lines(path.join(news, "extract", `${date}.jsonl`))) {
    const row = parse<ArchiveReading>(line);
    if (row?.id && (row.valid || !readings.has(row.id))) readings.set(row.id, row);
  }
  const mentions = new Map<string, ArchiveMention[]>();
  for (const day of [date, next]) for (const line of lines(path.join(news, "mentions", `${day}.jsonl`))) {
    const row = parse<ArchiveMention>(line);
    if (row?.id) mentions.set(row.id, [...(mentions.get(row.id) ?? []), row]);
  }
  const stories = buildStories({ items, date, readings, mentions, companies, tickerToCik, registry });
  writeJsonAtomic(dayFile(date), { schemaVersion: DESK_NEWS_SCHEMA_VERSION, date, builtAt: new Date().toISOString(), stories } satisfies DeskNewsDay);
  rebuilt++;
}

// the company files: every registry company, from the registry stories of the covered days
const covered: string[] = [];
const registryStories: DeskNewsStory[] = [];
for (const date of [...dates].reverse()) {
  if (!existsSync(dayFile(date))) continue;
  covered.push(date);
  const day = JSON.parse(readFileSync(dayFile(date), "utf8")) as DeskNewsDay;
  for (const story of day.stories) if (story.companies.some(company => company.registry)) registryStories.push(story);
}
const byCik = new Map<number, DeskNewsStory[]>();
for (const story of registryStories) for (const company of story.companies) if (company.registry) byCik.set(company.cik, [...(byCik.get(company.cik) ?? []), story]);
const builtAt = new Date().toISOString();
for (const cik of registry) {
  writeJsonAtomic(path.join(out, "company", `${cik}.json`), { schemaVersion: DESK_NEWS_SCHEMA_VERSION, cik, builtAt, days: covered, stories: companyStories(byCik.get(cik) ?? [], cik) } satisfies DeskNewsCompany);
}
console.log(JSON.stringify({ rebuiltDays: rebuilt, coveredDays: covered.length, registryStories: registryStories.length, companies: registry.size, withNews: byCik.size, seconds: Math.round((Date.now() - started) / 100) / 10 }));
