/**
 * News briefs for the followed companies (owner's go of 2026-11-25). Research product; nothing reaches production.
 *
 *   npx tsx worker/news-briefs.mts [--minutes 4] [--company TICKER] [--now ISO] [--dry-run] [--out TRIAL_DIR] [--redo-morning]
 *
 * Runs after every desk news build. On a New York weekday from 08:45 it writes each followed company's morning brief
 * of the news since the previous weekday's 16:00 close (waiting for the reader until 09:15 while followed stories are
 * unread); until 20:00 it adds timed updates when new picked stories come in. Later news waits for the next morning.
 * Followed = the active watchlists of the owner and of reviewers who accepted the NDA (alpha_engine, read only; when
 * the database is unreachable the last list is used). The list is also what the reader reads first.
 *
 * Inputs: the desk's day files (stories with ties and the reader's labels), the feed summaries from the archive's
 * items, the start of the article where its page could be read (fetched here ahead of the briefs, kept in articles/ on
 * D:; Google News and Nasdaq links stay headline-only), the company index, the desk snapshot (names, the price line). The model is gemma4:12b
 * (temperature 0, fixed seed); every number and name it writes is checked against the cited stories, and a part that
 * fails shows its headline instead. Every version is appended to briefs/<edition>/<cik>.jsonl on D: (complete, so
 * the record shows what the brief said and when); the desk reads worker/.runs/desk-news/briefs/<cik>.json.
 */
import "dotenv/config";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { DeskNewsDay, DeskNewsStory } from "../contracts/desk-news";
import { NEWS_BRIEF_SCHEMA_VERSION, type BriefPoint, type BriefSource, type NewsBrief } from "../contracts/news-briefs";
import { writeJsonAtomic } from "./lib/json-file";
import {
  BRIEF_MODEL, BRIEF_PROMPT_VERSION, briefAction, buildPoints, buildUpdates, checkedTopLine, etClock, MAX_ITEMS, MORNING_SCHEMA, MORNING_SYSTEM, morningMessage,
  openThreads, ordinaryWords, parseMorning, PICK_VERSION, parseUpdate, pickStories, sourceOf, UPDATE_SCHEMA, UPDATE_SYSTEM, updateMessage, type BriefInput, type OpenThread,
} from "./lib/news-briefs";
import { cleanArticle, fetchArticle, judgeArticle, type ArticleRecord } from "./lib/news-article";
import { readFollowed, writeFollowed, type FollowedFile } from "./lib/news-followed";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const root = path.resolve(arg("--root") ?? "D:/research/alpha-engine/news");
const deskDir = path.resolve("worker/.runs/desk-news");
// --out: a trial folder for the briefs; the desk copy and the followed list are then left alone
const trialOut = arg("--out") ? path.resolve(arg("--out")!) : null;
const briefsDir = trialOut ?? path.join(root, "briefs");
const minutes = Number(arg("--minutes") ?? 4), onlyTicker = arg("--company")?.toUpperCase() ?? null, dryRun = process.argv.includes("--dry-run"), redoMorning = process.argv.includes("--redo-morning");
const now = arg("--now") ? new Date(arg("--now")!) : new Date();
if (!(minutes > 0 && minutes <= 30)) throw new Error("--minutes must be above 0 and at most 30");
if (Number.isNaN(now.getTime())) throw new Error("--now is not a date");
for (const dir of ["items", "lookup"]) if (!existsSync(path.join(root, dir))) throw new Error(`The news archive is not complete at ${root} (no ${dir}); nothing was written`);
if (!/^d:/i.test(realpathSync(root)) && !arg("--root")) throw new Error("The news archive must resolve to D:");
if (!existsSync(path.join(deskDir, "days"))) throw new Error("No desk news files; run scripts/build-desk-news.mts first");
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const started = Date.now(), deadline = started + minutes * 60_000;

const readLines = (file: string) => existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
const parseLine = <T>(line: string): T | null => { try { return JSON.parse(line) as T; } catch { return null; } };

// the followed companies: fresh from the database, else the last list
const followedFile = path.join(root, "lookup", "followed.json");
let followed: FollowedFile;
try {
  followed = await readFollowed();
  if (!dryRun && !trialOut) writeFollowed(followedFile, followed);
} catch (error) {
  if (!existsSync(followedFile)) throw new Error(`The watchlists could not be read and no earlier list exists: ${(error as Error).message}`);
  followed = JSON.parse(readFileSync(followedFile, "utf8")) as FollowedFile;
  console.log(JSON.stringify({ warning: "watchlists unreadable; the list of " + followed.builtAt + " is used", error: String((error as Error).message).slice(0, 200) }));
}

const snapshot = JSON.parse(readFileSync(path.resolve("public/reports/desk-snapshot.json"), "utf8")) as { companies: { cik: number; ticker: string; name: string; close: number | null; lastDate: string | null; returns?: { d1?: number | null }; lastEarnings?: string | null; nextEarnings?: string | null }[] };
const deskCompany = new Map(snapshot.companies.map(company => [company.cik, company]));
const index = JSON.parse(readFileSync(path.join(root, "lookup", "company-index.json"), "utf8")) as { entries: { cik: number; tickers: string[]; names: string[] }[] };
const indexed = new Map(index.entries.map(entry => [entry.cik, entry]));

const fmtDay = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
function priceLine(cik: number): string | null {
  const company = deskCompany.get(cik);
  if (!company?.close || !company.lastDate) return null;
  const change = company.returns?.d1;
  return `Closed at $${company.close.toFixed(2)} on ${fmtDay(company.lastDate)}${typeof change === "number" ? `, ${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(1)}% on the day` : ""}.`;
}

// stories by first-seen time (what we had, when), with the feed summaries joined from the archive
const stories: DeskNewsStory[] = [];
const summaries = new Map<string, string>();
const dayTexts: string[] = [];
const windowStart = new Date(now.getTime() - 4 * 86_400_000);
for (let time = windowStart.getTime(); time <= now.getTime() + 86_400_000; time += 86_400_000) {
  const date = new Date(time).toISOString().slice(0, 10);
  const file = path.join(deskDir, "days", `${date}.json`);
  if (existsSync(file)) for (const story of (JSON.parse(readFileSync(file, "utf8")) as DeskNewsDay).stories) if (story.firstSeenAt <= now.toISOString()) stories.push(story);
  for (const line of readLines(path.join(root, "items", `${date}.jsonl`))) {
    const row = parseLine<{ id: string; title: string; summary?: string | null }>(line);
    if (row?.summary) dayTexts.push(row.summary);
    if (!row?.summary) continue;
    // a summary that only repeats the headline (Google News adds the outlet) says nothing more
    let text = row.summary.replace(/\s+/g, " ").trim();
    const head = row.title.replace(/ - [^-]+$/, "").trim();
    if (text.toLowerCase().startsWith(head.toLowerCase().slice(0, 40))) text = text.slice(head.length).trim();
    if (text.length > 25) summaries.set(row.id, text);
  }
}

// summaries only: headlines are in Title Case, so a word there says nothing about whether it is a name
const ordinary = ordinaryWords(dayTexts);

// article texts (worker/lib/news-article.ts), kept in articles/<UTC date of the fetch>.jsonl on D:, one record per try
const articlesDir = path.join(root, "articles");
const articles = new Map<string, ArticleRecord[]>();
for (let time = windowStart.getTime(); time <= now.getTime() + 86_400_000; time += 86_400_000)
  for (const line of readLines(path.join(articlesDir, `${new Date(time).toISOString().slice(0, 10)}.jsonl`))) {
    const record = parseLine<ArticleRecord>(line);
    if (record) articles.set(record.storyId, [...(articles.get(record.storyId) ?? []), record]);
  }
// a stored text is judged again by the current rules (a record of an earlier rule version may pass no longer)
function articleOf(story: DeskNewsStory): string | undefined {
  const record = articles.get(story.id)?.find(entry => entry.ok);
  if (!record) return undefined;
  const text = cleanArticle(record.text);
  return judgeArticle(story.title, text).ok ? text : undefined;
}
// asked again only after a network error or a server error, at most twice in all
const retryable = (records: ArticleRecord[]) => records.length < 2 && records.every(record => record.reason?.startsWith("error:") || record.status === 429 || record.status >= 500);

/**
 * Fetches, ahead of the briefs, the pages of the stories a brief would pick now (each followed company's picks of the
 * last 30 hours), newest first, one page at a time, at most one request per outlet every 1.5 s, for at most
 * --fetch-seconds (default 75) and never past the run's deadline less three minutes for the model.
 */
async function prefetchArticles(): Promise<{ asked: number; ok: number }> {
  const since = new Date(now.getTime() - 30 * 3_600_000).toISOString();
  const wanted = new Map<string, DeskNewsStory>();
  for (const cik of followed.ciks) {
    const tied = stories.filter(story => story.firstSeenAt >= since && story.companies.some(company => company.cik === cik));
    for (const story of pickStories(tied, cik, since, deskCompany.get(cik)).picked) {
      if (story.secItems.length || articleOf(story) !== undefined) continue;
      const tried = articles.get(story.id) ?? [];
      if (tried.length && !retryable(tried)) continue;
      wanted.set(story.id, story);
    }
  }
  const queue = [...wanted.values()].sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));
  const until = Math.min(Date.now() + Number(arg("--fetch-seconds") ?? 75) * 1000, deadline - 180_000);
  const lastAsked = new Map<string, number>();
  let asked = 0, ok = 0;
  mkdirSync(articlesDir, { recursive: true });
  for (const story of queue) {
    if (Date.now() >= until) break;
    let host = "";
    try { host = new URL(story.url).hostname; } catch { /* the record says why */ }
    const wait = (lastAsked.get(host) ?? 0) + 1500 - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    const record = await fetchArticle(story.id, story.url, story.title);
    if (!record.reason?.startsWith("skipped")) { lastAsked.set(host, Date.now()); asked++; }
    if (record.ok) ok++;
    appendFileSync(path.join(articlesDir, `${record.fetchedAt.slice(0, 10)}.jsonl`), JSON.stringify(record) + "\n");
    articles.set(story.id, [...(articles.get(story.id) ?? []), record]);
  }
  return { asked, ok };
}
const fetched = dryRun ? { asked: 0, ok: 0 } : await prefetchArticles();
let ollama: { digest: string; version: string | null } | null = null;
async function model(system: string, schema: object, user: string): Promise<string> {
  if (!ollama) {
    const tags = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) }).then(response => response.ok ? response.json() as Promise<{ models: { name: string; digest: string }[] }> : null).catch(() => null);
    if (!tags) throw new Error("Local Ollama is unavailable on port 11434");
    const digest = tags.models.find(entry => entry.name === BRIEF_MODEL)?.digest;
    if (!digest) throw new Error(`${BRIEF_MODEL} is not installed in Ollama`);
    const version = await fetch(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(5000) }).then(response => response.json() as Promise<{ version: string }>).then(body => body.version).catch(() => null);
    ollama = { digest, version };
  }
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(240_000),
    body: JSON.stringify({ model: BRIEF_MODEL, stream: false, format: schema, think: false, keep_alive: "15m", options: { num_ctx: 32768, temperature: 0, seed: 7 },
      messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json() as { message: { content: string } }).message.content;
}

/** Filings first, then new news, then follow-ups; newest first within each. */
const order = (a: DeskNewsStory, b: DeskNewsStory) => {
  const rank = (story: DeskNewsStory) => story.secItems.length ? 0 : story.reading?.novelty === "new" ? 1 : 2;
  return rank(a) - rank(b) || (b.publishedAt ?? b.firstSeenAt).localeCompare(a.publishedAt ?? a.firstSeenAt);
};
const othersOf = (picked: DeskNewsStory[], cited: Set<string>): BriefSource[] => picked.filter(story => !cited.has(story.id))
  .sort((a, b) => (b.publishedAt ?? b.firstSeenAt).localeCompare(a.publishedAt ?? a.firstSeenAt)).slice(0, 20)
  .map(story => sourceOf({ story, summary: "" }));
const citedIds = (brief: Pick<NewsBrief, "points" | "updates">) => new Set([...brief.points, ...brief.updates].flatMap(part => part.sources.map(source => source.id)));

function previousBriefs(cik: number, edition: string): NewsBrief[] {
  const dir = briefsDir;
  if (!existsSync(dir)) return [];
  const out: NewsBrief[] = [];
  for (const date of readdirSync(dir).filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name) && name < edition).sort().slice(-4)) {
    const last = readLines(path.join(dir, date, `${cik}.jsonl`)).map(line => parseLine<NewsBrief>(line)).filter(Boolean).at(-1);
    if (last) out.push(last);
  }
  return out;
}

const counts = { morning: 0, updates: 0, checks: 0, waiting: 0, quiet: 0, failedChecks: 0, invalid: 0, left: 0 };
const waiting: string[] = [];
for (const cik of followed.ciks) {
  const desk = deskCompany.get(cik), entry = indexed.get(cik);
  const ticker = desk?.ticker ?? followed.tickers[String(cik)] ?? entry?.tickers[0] ?? null;
  if (onlyTicker && ticker !== onlyTicker) continue;
  const clock = etClock(now);
  const file = path.join(briefsDir, clock.date, `${cik}.jsonl`);
  const versions = readLines(file).map(line => parseLine<NewsBrief>(line)).filter((brief): brief is NewsBrief => Boolean(brief));
  const latest = versions.at(-1) ?? null;
  // --redo-morning writes the day's morning brief again (after a rule change), appended: the earlier versions stay
  const action = briefAction(now, Boolean(latest) && !redoMorning);
  if (action.kind === "none") continue;
  if (Date.now() >= deadline) { counts.left++; continue; }

  const name = desk?.name ?? entry?.names[0] ?? ticker ?? String(cik);
  const context = { names: [name, ...(entry?.names ?? []), ...(entry?.tickers ?? []), ticker ?? ""].filter(Boolean), ordinary };
  const from = action.kind === "morning" ? action.from : latest!.from;
  const inWindow = stories.filter(story => story.firstSeenAt >= from && story.companies.some(company => company.cik === cik));
  const pick = pickStories(inWindow, cik, from, desk);
  const picked = [...pick.picked].sort(order);
  const toInput = (story: DeskNewsStory): BriefInput => ({ story, summary: summaries.get(story.id) ?? "", article: articleOf(story) });
  // a morning brief continues the stories of earlier days only (a redone one never its own first version)
  const threads = openThreads([...previousBriefs(cik, clock.date), ...(latest && action.kind === "update" ? [latest] : [])], now);
  const company = `${name}${ticker ? ` (${ticker})` : ""}`;
  const base = { schemaVersion: NEWS_BRIEF_SCHEMA_VERSION, cik, ticker, name, edition: clock.date, from, to: now.toISOString(), generatedAt: now.toISOString(),
    price: priceLine(cik), model: BRIEF_MODEL, promptVersion: BRIEF_PROMPT_VERSION, pickVersion: PICK_VERSION };
  const tally = (given: number, texts: number) => ({ stories: inWindow.length, picked: picked.length, given, skipped: pick.skipped, unread: pick.unread.length, texts });

  let brief: NewsBrief;
  if (action.kind === "morning") {
    if (action.waitForReader && pick.unread.length > 0) { counts.waiting++; waiting.push(`${ticker} ${pick.unread.length}`); continue; }
    const inputs = picked.slice(0, MAX_ITEMS).map(toInput);
    if (!inputs.length) {
      counts.quiet++;
      brief = { ...base, kind: "morning", topLine: { text: "No news of note since the close.", checked: true, changedAt: now.toISOString() }, points: [], updates: [], counts: tally(0, 0), others: [], inputs: [], modelDigest: null, ollamaVersion: null };
    } else {
      const message = morningMessage(company, threads, inputs);
      if (dryRun) { console.log(`---- ${ticker} morning\n${message}\n`); continue; }
      const answer = parseMorning(await model(MORNING_SYSTEM, MORNING_SCHEMA, message));
      let points: BriefPoint[];
      let topLine;
      if (answer) {
        points = buildPoints(answer, inputs, threads, context);
        const citedSet = new Set(points.flatMap(point => point.sources.map(source => source.id)));
        const cited = inputs.filter(input => citedSet.has(input.story.id));
        topLine = checkedTopLine(answer.topLine, cited, context, points[0]?.title ?? inputs[0].story.title);
      } else {
        counts.invalid++;
        points = inputs.slice(0, 4).map(input => ({ thread: input.story.id, continues: false, since: input.story.publishedAt ?? input.story.firstSeenAt, title: input.story.title, text: "", sources: [sourceOf(input)], checked: false, problems: ["the model's answer was not valid; headlines shown"] }));
        topLine = { text: inputs[0].story.title, checked: false, problems: ["the model's answer was not valid"] };
      }
      counts.failedChecks += points.filter(point => !point.checked).length + (topLine.checked ? 0 : 1);
      brief = { ...base, kind: "morning", topLine: { ...topLine, changedAt: now.toISOString() }, points, updates: [], counts: tally(inputs.length, inputs.filter(input => input.article).length), others: [], inputs: inputs.map(input => input.story.id), modelDigest: ollama?.digest ?? null, ollamaVersion: ollama?.version ?? null };
      brief.others = othersOf(picked, citedIds(brief));
    }
    counts.morning++;
  } else {
    const seen = new Set(latest!.inputs);
    const fresh = picked.filter(story => !seen.has(story.id)).slice(0, MAX_ITEMS);
    if (!fresh.length) continue;
    const inputs = fresh.map(toInput);
    // today's points lead the list of threads the update may add to
    const todays: OpenThread[] = latest!.points.map(point => ({ id: point.thread, title: point.title, text: point.text, since: point.since, lastAt: point.sources.map(source => source.at).sort().at(-1) ?? latest!.generatedAt }));
    const list = [...todays, ...threads.filter(thread => !todays.some(today => today.id === thread.id))].slice(0, 10);
    const message = updateMessage(company, latest!.topLine.text, list, inputs);
    if (dryRun) { console.log(`---- ${ticker} update\n${message}\n`); continue; }
    const answer = parseUpdate(await model(UPDATE_SYSTEM, UPDATE_SCHEMA, message));
    if (!answer) counts.invalid++;
    const updates = answer ? buildUpdates(answer, inputs, list, context, now.toISOString()) : [];
    counts.failedChecks += updates.filter(update => !update.checked).length;
    let topLine = latest!.topLine;
    if (answer?.topLine) {
      const checked = checkedTopLine(answer.topLine, inputs, context, latest!.topLine.text);
      if (checked.checked) topLine = { ...checked, changedAt: now.toISOString() };
      else counts.failedChecks++;
    }
    brief = { ...latest!, ...base, kind: updates.length ? "update" : "check", topLine, updates: [...latest!.updates, ...updates], counts: tally(latest!.counts.given + inputs.length, (latest!.counts.texts ?? 0) + inputs.filter(input => input.article).length),
      inputs: [...latest!.inputs, ...inputs.map(input => input.story.id)], modelDigest: ollama?.digest ?? latest!.modelDigest, ollamaVersion: ollama?.version ?? latest!.ollamaVersion };
    brief.others = othersOf(picked, citedIds(brief));
    if (updates.length) counts.updates++; else counts.checks++;
  }
  if (dryRun) continue;
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(brief) + "\n");
  if (!trialOut) writeJsonAtomic(path.join(deskDir, "briefs", `${cik}.json`), brief);
}
console.log(JSON.stringify({ at: now.toISOString(), followed: followed.ciks.length, ...counts, articlesAsked: fetched.asked, articlesOk: fetched.ok, waitingFor: waiting.slice(0, 12), promptVersion: BRIEF_PROMPT_VERSION, seconds: Math.round((Date.now() - started) / 100) / 10 }));
process.exit(0);   // the database pool would keep the process alive
