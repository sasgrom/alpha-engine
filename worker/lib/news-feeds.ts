/**
 * News feeds (owner, 2026-11-25: "lets get everything we can, decide later based on value"; "watch out for the
 * duplicates of the same articles, as everybody copies everyone").
 *
 * This module holds the pure parts: the feed list, an RSS/Atom parser, canonical URLs and titles, near-duplicate
 * detection, and the company tags a feed itself carries. The collector (worker/news-feeds.mts) stores every answer as
 * received and one normalized row per new item, with our own first-seen time: that time, not the feed's claimed
 * publication time, is when the news was available to us.
 */
import { createHash } from "node:crypto";

export type FeedSet = "fast" | "company" | "macro";
export interface FeedSource { id: string; set: FeedSet; url: string; sec?: boolean; publisher: string }
export interface CompanyFeed { id: string; publisher: string; url: (ticker: string, name: string) => string }

/** Feeds that cover everyone, polled every few minutes (they hold only the latest 7 to 100 items). */
export const FAST_FEEDS: FeedSource[] = [
  { id: "sec-8k-current", set: "fast", sec: true, publisher: "SEC EDGAR", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&start=0&count=100&output=atom" },
  { id: "globenewswire-public", set: "fast", publisher: "GlobeNewswire", url: "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies" },
  { id: "prnewswire-all", set: "fast", publisher: "PR Newswire", url: "https://www.prnewswire.com/rss/news-releases-list.rss" },
  { id: "seekingalpha-currents", set: "fast", publisher: "Seeking Alpha", url: "https://seekingalpha.com/market_currents.xml" },
  { id: "marketwatch-top", set: "fast", publisher: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { id: "benzinga", set: "fast", publisher: "Benzinga", url: "https://www.benzinga.com/feed" },
  { id: "cnbc-business", set: "fast", publisher: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147" },
  { id: "nasdaq-earnings", set: "fast", publisher: "Nasdaq", url: "https://www.nasdaq.com/feed/rssoutbound?category=Earnings" },
];
/** Official macro releases, polled with the company pass. */
export const MACRO_FEEDS: FeedSource[] = [
  { id: "fed-press", set: "macro", publisher: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { id: "bls-latest", set: "macro", publisher: "BLS", url: "https://www.bls.gov/feed/bls_latest.rss" },
  { id: "bea", set: "macro", publisher: "BEA", url: "https://apps.bea.gov/rss/rss.xml" },
];
/** Per-company feeds: they reach back days to weeks, so a pass over the registry a few times a day is enough. */
export const COMPANY_FEEDS: CompanyFeed[] = [
  { id: "google-news", publisher: "Google News", url: (ticker, name) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${name} ${ticker}`)}&hl=en-US&gl=US&ceid=US:en` },
  { id: "nasdaq-symbol", publisher: "Nasdaq", url: ticker => `https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(ticker)}` },
  { id: "seekingalpha-symbol", publisher: "Seeking Alpha", url: ticker => `https://seekingalpha.com/api/sa/combined/${encodeURIComponent(ticker)}.xml` },
  // owner, 2026-11-25 (AGENTS.md): "read Yahoo's resources as needed"; about 20 headlines, half a day for a large company
  { id: "yahoo-headlines", publisher: "Yahoo Finance", url: ticker => `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker.replace(".", "-"))}&region=US&lang=en-US` },
];

/**
 * A per-company answer that may have lost items since we last asked for that company: at least 10 items, and even the
 * oldest was published after our previous ask (the feed rolled past it).
 */
export function companyGap(items: FeedItem[], previousAsk: string | null): boolean {
  if (!previousAsk || items.length < 10) return false;
  const times = items.map(item => item.publishedAt).filter((time): time is string => Boolean(time));
  return times.length === items.length && times.every(time => time > previousAsk);
}

export interface FeedItem {
  guid: string; url: string | null; title: string; summary: string; publishedAt: string | null;
  categories: { domain: string | null; value: string }[]; publisher: string | null; contributor: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}
const unwrap = (text: string) => decodeEntities(text.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")).trim();
export const plainText = (html: string) => decodeEntities(decodeEntities(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return match ? unwrap(match[1]) : null;
}
function attr(block: string, name: string, attribute: string): string | null {
  const match = block.match(new RegExp(`<${name}\\b[^>]*\\b${attribute}\\s*=\\s*"([^"]*)"`, "i"));
  return match ? decodeEntities(match[1]) : null;
}
function isoTime(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** RSS 2.0 items or Atom entries. Tolerant of namespaces, CDATA and attributes split over lines. */
export function parseFeed(text: string): FeedItem[] {
  const blocks = [...text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
  const atom = blocks.length ? [] : [...text.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(m => m[1]);
  return [...blocks, ...atom].map(block => {
    const link = tag(block, "link") || attr(block, "link", "href");
    const guid = tag(block, "guid") || tag(block, "id") || link || "";
    const categories = [...block.matchAll(/<category\b([^>]*)>([\s\S]*?)<\/category>/gi)].map(m => ({ domain: (m[1].match(/domain\s*=\s*"([^"]*)"/i)?.[1]) ?? null, value: unwrap(m[2]) }))
      .concat([...block.matchAll(/<category\b([^>]*?)\/>/gi)].map(m => ({ domain: m[1].match(/label\s*=\s*"([^"]*)"/i)?.[1] ?? null, value: decodeEntities(m[1].match(/term\s*=\s*"([^"]*)"/i)?.[1] ?? "") })));
    return {
      guid: guid.trim(), url: link ? link.trim() : null, title: plainText(tag(block, "title") ?? ""),
      summary: plainText(tag(block, "description") ?? tag(block, "summary") ?? tag(block, "content") ?? "").slice(0, 4000),
      publishedAt: isoTime(tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated") ?? tag(block, "dc:date")),
      categories: categories.filter(row => row.value),
      publisher: tag(block, "source") ?? tag(block, "dc:publisher"), contributor: tag(block, "dc:contributor") ?? tag(block, "dc:creator"),
    };
  }).filter(item => item.guid || item.title);
}

const TRACKING = /^(utm_|fbclid$|gclid$|guccounter$|guce_|ocid$|cmpid$|mod$|ref$|src$|feedtype$|yptr$|.?tsrc$|taid$)/i;
/** The same article under different addresses: lower-case host without www, no tracking parameters, no fragment. */
export function canonicalUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    const keep = [...parsed.searchParams].filter(([key]) => !TRACKING.test(key)).sort((a, b) => a[0].localeCompare(b[0]));
    const query = keep.length ? `?${keep.map(([key, value]) => `${key}=${value}`).join("&")}` : "";
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "").replace(/\/amp$/, "")}${query}`;
  } catch {
    return null;
  }
}

/** A title reduced to its words: no " - Publisher" tail (Google News adds one), no punctuation or case. */
export function normalizeTitle(title: string, publisher: string | null = null): string {
  let text = plainText(title);
  if (publisher && text.endsWith(` - ${publisher}`)) text = text.slice(0, -(publisher.length + 3));
  return text.toLowerCase().replace(/['’`]/g, "").replace(/[^\p{L}\p{N}$%.]+/gu, " ").replace(/\s\.|\.\s|\.$/g, " ").replace(/\s+/g, " ").trim();
}

/** Words that outlets add, drop or swap when they copy a title; a difference in any other word is a different story. */
export const FILLER = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "its", "it", "as", "at", "by", "from", "is", "are", "be", "has", "have", "this", "that", "after", "amid", "over", "new", "says", "said", "report", "reports", "announces", "announced"]);
const words = (title: string) => new Set(title.split(" ").filter(Boolean));

/**
 * Two normalized titles tell one story when at least 80% of their words are shared and every word only one of them
 * has is a filler word. Deliberately strict: "Acme reports …" and "Globex reports …" stay apart (the words that
 * differ are names), while "Results and Raises" and "Results, Raises" are one story. A missed copy only costs a
 * duplicate row; a false merge would hide news.
 */
export function sameStory(a: string, b: string): boolean {
  if (a === b) return a.length > 0;
  const x = words(a), y = words(b);
  if (x.size < 5 || y.size < 5) return false;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared++;
  if (shared / (x.size + y.size - shared) < 0.8) return false;
  for (const word of x) if (!y.has(word) && !FILLER.has(word)) return false;
  for (const word of y) if (!x.has(word) && !FILLER.has(word)) return false;
  return true;
}

export interface StoryKey { storyId: string; title: string; url: string | null; seenAt: string }
/** The recent stories, indexed by canonical URL, exact title, and each title's non-filler words. */
export class StoryIndex {
  private readonly byUrl = new Map<string, StoryKey>();
  private readonly byTitle = new Map<string, StoryKey>();
  private readonly byWord = new Map<string, StoryKey[]>();
  constructor(readonly stories: StoryKey[] = []) { for (const story of stories) this.index(story); }
  private index(story: StoryKey): void {
    if (story.url) this.byUrl.set(story.url, story);
    if (story.title) this.byTitle.set(story.title, story);
    for (const word of words(story.title)) if (!FILLER.has(word)) { const list = this.byWord.get(word); if (list) list.push(story); else this.byWord.set(word, [story]); }
  }
  add(story: StoryKey): void { this.stories.push(story); this.index(story); }
  /** The story an item belongs to (same canonical URL, same title, or sameStory), or null for a new story. */
  match(title: string, url: string | null): StoryKey | null {
    if (url && this.byUrl.has(url)) return this.byUrl.get(url)!;
    if (!title) return null;
    if (this.byTitle.has(title)) return this.byTitle.get(title)!;
    // candidates share the title's rarest non-filler word (every copy must contain all of them)
    const keys = [...words(title)].filter(word => !FILLER.has(word));
    if (keys.length < 3) return null;
    const rarest = keys.map(word => this.byWord.get(word) ?? []).sort((p, q) => p.length - q.length)[0];
    return rarest.find(story => sameStory(title, story.title)) ?? null;
  }
}

/** Company tags the feed itself carries: exchange:ticker categories (GlobeNewswire), the filer CIK (SEC). */
export function feedTags(feedId: string, item: FeedItem): { tickers: string[]; ciks: number[]; isins: string[]; secItems: string[] } {
  const tickers = new Set<string>(), ciks = new Set<number>(), isins = new Set<string>(), secItems: string[] = [];
  for (const row of item.categories) {
    if (/\/stock$/i.test(row.domain ?? "")) {
      const match = row.value.match(/^(NYSE|NASDAQ|Nasdaq|NYSE American|NYSE Arca|AMEX|CBOE|OTC\w*):\s*([A-Z][A-Z0-9.\-]{0,9})$/);
      if (match) tickers.add(match[2].toUpperCase());
    }
    if (/\/isin$/i.test(row.domain ?? "") && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(row.value)) isins.add(row.value);
  }
  if (feedId.startsWith("sec-")) {
    const cik = item.title.match(/\((\d{10})\)/)?.[1];
    if (cik) ciks.add(Number(cik));
    secItems.push(...[...item.summary.matchAll(/Item (\d+\.\d+)/g)].map(m => m[1]));
  }
  return { tickers: [...tickers], ciks: [...ciks], isins: [...isins], secItems };
}

export const itemId = (feedId: string, item: FeedItem) => createHash("sha256").update(`${feedId}\0${item.guid || item.url || item.title}`).digest("hex").slice(0, 24);
