/**
 * News collector (owner's go of 2026-11-25). Research input; nothing reaches production.
 *
 *   npx tsx worker/news-feeds.mts --set fast            wires, SEC current 8-Ks, market news (every few minutes)
 *   npx tsx worker/news-feeds.mts --set company [--batch 130]   per-company feeds for the followed companies
 *                                                       (lookup/followed.json) and the --batch other registry
 *                                                       tickers asked longest ago, plus the macro feeds
 *   [--dry-run] lists what would be asked; [--init] creates the empty archive once
 *
 * Archive D:\research\alpha-engine\news:
 *   raw/<feed>/<UTC date>/<time>[-<ticker>].xml.gz    every answer as received, gzipped, never rewritten
 *   items/<UTC date>.jsonl                            one row per new item, appended: our first-seen time (when the
 *                                                     news was available to us), the feed's publication time, tags,
 *                                                     and the story it belongs to (copies across sources share one)
 *   mentions/<UTC date>.jsonl                         a per-company feed returning an item already stored (ticker, id)
 *   state/feeds.json, state/stories.json, state/rotation.json   seen items, recent stories, company pass order
 * A gap is recorded when a feed's whole answer is new after an earlier fetch: items may have scrolled out unseen.
 * English only (owner, 2026-11-25): an item in another language (worker/lib/news-language.ts) stays in the raw answer,
 * is counted per feed as notEnglish in state/feeds.json, and is not stored as an item.
 * A missing archive (the D: drive may be away) stops the run and creates nothing.
 */
import "dotenv/config";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { getDb } from "../api/queries/connection";
import { secGet } from "./lib/edgar";
import { writeJsonAtomic } from "./lib/json-file";
import { canonicalUrl, COMPANY_FEEDS, companyGap, FAST_FEEDS, feedTags, itemId, MACRO_FEEDS, normalizeTitle, parseFeed, StoryIndex, type FeedItem, type StoryKey } from "./lib/news-feeds";
import { newsLanguage } from "./lib/news-language";
import { startProgress } from "./lib/progress";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : null; };
const root = path.resolve(arg("--root") ?? "D:/research/alpha-engine/news");
const set = arg("--set") ?? "fast", batch = Number(arg("--batch") ?? 130), dryRun = process.argv.includes("--dry-run");
if (set !== "fast" && set !== "company") throw new Error("--set must be fast or company");
if (!Number.isInteger(batch) || batch < 1 || batch > 600) throw new Error("--batch must be 1 to 600");
if (process.argv.includes("--init") && !existsSync(path.join(root, "state"))) {
  if (!/^d:/i.test(realpathSync(path.parse(root).root))) throw new Error("The news archive must be on D:");
  for (const dir of ["raw", "items", "mentions", "state"]) mkdirSync(path.join(root, dir), { recursive: true });
}
for (const dir of ["raw", "items", "mentions", "state"]) if (!existsSync(path.join(root, dir))) throw new Error(`The news archive is not complete at ${root} (no ${dir}); nothing was fetched or created (first run: --init)`);
if (!/^d:/i.test(realpathSync(root)) && !arg("--root")) throw new Error("The news archive must resolve to D:");

interface FeedState { lastFetchAt: string | null; fetches: number; newItems: number; gaps: number; errors: number; lastError: string | null; seen: Record<string, string>; gapTickers?: Record<string, number>; notEnglish?: number }
const readJson = <T>(file: string, fallback: T): T => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as T : fallback;
const feedsFile = path.join(root, "state", "feeds.json"), storiesFile = path.join(root, "state", "stories.json"), rotationFile = path.join(root, "state", "rotation.json");
const feeds = readJson<Record<string, FeedState>>(feedsFile, {});
const stories = readJson<StoryKey[]>(storiesFile, []);
const rotation = readJson<Record<string, string>>(rotationFile, {});
const now = new Date(), nowIso = now.toISOString(), day = nowIso.slice(0, 10), stamp = nowIso.slice(11, 23).replace(/[:.]/g, "");
// seen items are kept 45 days (per-company feeds reach back weeks), stories 7 days
const keepSeen = Date.now() - 45 * 86_400_000, keepStory = Date.now() - 7 * 86_400_000;
const storyIndex = new StoryIndex(stories.filter(row => Date.parse(row.seenAt) >= keepStory));

type Request = { feedId: string; publisher: string; url: string; sec?: boolean; ticker?: string; cik?: number; zonelessTimes?: "utc" };
const requests: Request[] = [];
if (set === "fast") requests.push(...FAST_FEEDS.map(feed => ({ feedId: feed.id, publisher: feed.publisher, url: feed.url, sec: feed.sec, zonelessTimes: feed.zonelessTimes })));
let picked: { cik: number; ticker: string; name: string }[] = [];
if (set === "company") {
  const client = getDb().$client.promise();
  const [rows] = await client.query("SELECT cik, ticker, name FROM companies WHERE cik > 0 AND ticker IS NOT NULL AND ticker <> ''") as [Array<{ cik: number; ticker: string; name: string | null }>, unknown];
  await client.end();
  const registry = rows.map(row => ({ cik: Number(row.cik), ticker: String(row.ticker).trim().toUpperCase(), name: cleanName(String(row.name ?? row.ticker)) }));
  // followed companies (lookup/followed.json, the news briefs' list) are asked on every pass; --batch others rotate
  const followedFile = path.join(root, "lookup", "followed.json");
  const followed = new Set<number>(existsSync(followedFile) ? (JSON.parse(readFileSync(followedFile, "utf8")) as { ciks: number[] }).ciks : []);
  const byRotation = (a: { ticker: string }, b: { ticker: string }) => (rotation[a.ticker] ?? "").localeCompare(rotation[b.ticker] ?? "") || a.ticker.localeCompare(b.ticker);
  picked = [...registry.filter(company => followed.has(company.cik)).sort(byRotation), ...registry.filter(company => !followed.has(company.cik)).sort(byRotation).slice(0, batch)];
  // interleave the hosts so that each is asked at most once every few seconds
  for (const feed of COMPANY_FEEDS) for (const [i, company] of picked.entries()) requests.push({ feedId: feed.id, publisher: feed.publisher, url: feed.url(company.ticker, company.name), ticker: company.ticker, cik: company.cik, order: i } as Request & { order: number });
  requests.sort((a: any, b: any) => a.order - b.order);
  requests.push(...MACRO_FEEDS.map(feed => ({ feedId: feed.id, publisher: feed.publisher, url: feed.url })));
}
function cleanName(name: string): string {
  return name.replace(/\b(Inc|Incorporated|Corp|Corporation|Co|Company|Ltd|Limited|plc|PLC|N\.?V|S\.?A|Holdings?|Group|The)\b\.?,?/g, " ").replace(/[,.]+$/g, "").replace(/\s+/g, " ").trim() || name;
}

const prog = startProgress("news-feeds", `${set} · ${requests.length} requests${picked.length ? ` · ${picked.length} companies from ${picked[0].ticker}` : ""}${dryRun ? " · dry run" : ""}`);
if (dryRun) {
  prog.done(`dry run · ${requests.slice(0, 12).map(row => `${row.feedId}${row.ticker ? `:${row.ticker}` : ""}`).join(", ")}${requests.length > 12 ? " …" : ""}`);
  process.exit(0);
}

const counts = { requests: 0, newItems: 0, mentions: 0, duplicates: 0, gaps: 0, errors: 0, notEnglish: 0 };
const itemsFile = path.join(root, "items", `${day}.jsonl`), mentionsFile = path.join(root, "mentions", `${day}.jsonl`);
async function fetchText(request: Request): Promise<string> {
  const response = request.sec ? await secGet(request.url) : await fetch(request.url, { headers: { "User-Agent": "Mozilla/5.0 (research client)", Accept: "application/rss+xml, application/atom+xml, text/xml, */*" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}
// per feed: the least time between two requests (Google News answers 429 when asked faster), and feeds that refused
// this run (HTTP 429): they are not asked again until the next run
const SPACING_MS: Record<string, number> = { "google-news": 8000, "yahoo-headlines": 3000 }, lastAsked = new Map<string, number>(), refused = new Set<string>();
for (const request of requests) {
  if (refused.has(request.feedId)) continue;
  const wait = Math.max(counts.requests > 0 ? (set === "fast" ? 800 : 1200) : 0, (lastAsked.get(request.feedId) ?? 0) + (SPACING_MS[request.feedId] ?? 0) - Date.now());
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  counts.requests++;
  lastAsked.set(request.feedId, Date.now());
  const state = feeds[request.feedId] ??= { lastFetchAt: null, fetches: 0, newItems: 0, gaps: 0, errors: 0, lastError: null, seen: {} };
  let text: string;
  try {
    text = await fetchText(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.errors++;
    state.lastError = `${nowIso} ${request.ticker ?? ""} ${message}`.slice(0, 200);
    counts.errors++;
    if (message === "HTTP 429") { refused.add(request.feedId); prog.log(`${request.feedId} refused with HTTP 429 at ${request.ticker ?? "-"}; not asked again this run`); }
    continue;
  }
  const rawDir = path.join(root, "raw", request.feedId, day);
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(path.join(rawDir, `${stamp}${request.ticker ? `-${request.ticker.replace(/[^A-Z0-9.-]/g, "_")}` : ""}.xml.gz`), gzipSync(text), { flag: "wx" });
  let items: FeedItem[];
  try { items = parseFeed(text, { zonelessTimes: request.zonelessTimes }); } catch { items = []; }
  const fresh = items.filter(item => !state.seen[itemId(request.feedId, item)]);
  // a whole answer of new items after an earlier fetch of the same feed (not a per-company query): possibly missed items
  if (!request.ticker && state.lastFetchAt && items.length >= 5 && fresh.length === items.length) { state.gaps++; counts.gaps++; }
  // per company: the answer starts after our previous ask for that company, so older items may be lost
  if (request.ticker && companyGap(items, rotation[request.ticker] ?? null)) {
    state.gaps++; counts.gaps++;
    state.gapTickers = { ...state.gapTickers, [request.ticker]: (state.gapTickers?.[request.ticker] ?? 0) + 1 };
  }
  for (const item of items) {
    const id = itemId(request.feedId, item);
    if (state.seen[id]) {
      if (request.ticker) { appendFileSync(mentionsFile, `${JSON.stringify({ id, feed: request.feedId, ticker: request.ticker, cik: request.cik, at: nowIso })}\n`); counts.mentions++; }
      continue;
    }
    state.seen[id] = nowIso;
    const publisher = item.publisher ?? request.publisher;
    // English only (owner, 2026-11-25): another language is counted and left in the raw answer, never stored as an item
    if (!newsLanguage({ title: item.title, summary: item.summary, publisher, url: item.url }).english) {
      state.notEnglish = (state.notEnglish ?? 0) + 1;
      counts.notEnglish++;
      continue;
    }
    const title = normalizeTitle(item.title, item.publisher), url = canonicalUrl(item.url);
    const story = storyIndex.match(title, url), tags = feedTags(request.feedId, item);
    let storyId: string;
    if (story) { storyId = story.storyId; counts.duplicates++; }
    else { storyId = id; storyIndex.add({ storyId: id, title, url, seenAt: nowIso }); }
    appendFileSync(itemsFile, `${JSON.stringify({
      id, feed: request.feedId, publisher, contributor: item.contributor, guid: item.guid, url: item.url, canonicalUrl: url, title: item.title, summary: item.summary.slice(0, 1500),
      publishedAt: item.publishedAt, firstSeenAt: nowIso, query: request.ticker ? { ticker: request.ticker, cik: request.cik } : null,
      tickers: tags.tickers, ciks: tags.ciks, isins: tags.isins, secItems: tags.secItems, categories: item.categories.slice(0, 12).map(row => row.value), storyId, copyOfEarlierStory: Boolean(story),
    })}\n`);
    counts.newItems++;
    state.newItems++;
  }
  state.fetches++;
  state.lastFetchAt = nowIso;
  if (request.ticker) rotation[request.ticker] = nowIso;
}
for (const state of Object.values(feeds)) for (const [id, at] of Object.entries(state.seen)) if (Date.parse(at) < keepSeen) delete state.seen[id];
writeJsonAtomic(feedsFile, feeds);
writeJsonAtomic(storiesFile, storyIndex.stories);
if (set === "company") writeJsonAtomic(rotationFile, rotation);
prog.done(`${counts.requests} requests · ${counts.newItems} new items (${counts.duplicates} copies of a story seen before) · ${counts.notEnglish} not in English, not stored · ${counts.mentions} repeat mentions · gaps ${counts.gaps} · errors ${counts.errors}`);
process.exit(0);
