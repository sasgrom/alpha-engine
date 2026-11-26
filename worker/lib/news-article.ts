/**
 * Article text for the stories a news brief picks (owner's go of 2026-11-26, after the measurement).
 *
 * Measured on 192 followed-company stories of 2026-11-25 (D:/research/alpha-engine/news/article-trial):
 * - Google News links open a redirect page, not the article (88 of 192): skipped, they stay headline-only.
 * - nasdaq.com answers 403 (24): skipped.
 * - finance.yahoo.com sends headers larger than Node's default limit, so a plain fetch fails. With a larger limit,
 *   8 of 8 pages gave the article.
 * - Seeking Alpha opinion pieces (/article/) show only a teaser behind the paywall; its news pages work.
 * A text counts only when it is long enough and shares at least half of the headline's words: a consent page, a
 * paywall teaser or a site's front page does not pass.
 */
import { createHash } from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { Agent, fetch as undiciFetch } from "undici";

export const ARTICLE_SCHEMA_VERSION = 1;
/** What is kept on D: per article (the brief's model sees the first ARTICLE_CHARS of news-briefs.ts). */
export const ARTICLE_KEEP_CHARS = 20_000;
export const ARTICLE_MIN_CHARS = 600;
export const ARTICLE_MIN_OVERLAP = 0.5;

/** Hosts not asked at all, with the measured reason. */
export const ARTICLE_SKIP: Record<string, string> = {
  "news.google.com": "redirect page, no article",
  "nasdaq.com": "HTTP 403",
};
export function skipReason(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (ARTICLE_SKIP[host]) return ARTICLE_SKIP[host];
    if (host === "seekingalpha.com" && new URL(url).pathname.startsWith("/article/")) return "paywall teaser";
    return null;
  } catch {
    return "not a URL";
  }
}

export interface ArticleRecord {
  schemaVersion: number;
  storyId: string;
  url: string;
  finalUrl: string | null;
  fetchedAt: string;
  status: number;
  ok: boolean;
  /** Why the text was not used: skipped host, HTTP status, too short, off the headline, or the error. */
  reason: string | null;
  chars: number;
  overlap: number;
  byline: string | null;
  sha256: string | null;
  /** The text, at most ARTICLE_KEEP_CHARS; empty when not ok. */
  text: string;
}

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
/** Share of the headline's words (four letters or more) found in the article's first 4,000 characters. */
export function headlineOverlap(title: string, text: string): number {
  const head = words(title), body = words(text.slice(0, 4000));
  if (!head.size) return 0;
  return [...head].filter(word => body.has(word)).length / head.size;
}

/** The readable text of a page, whitespace collapsed. */
export function readableText(html: string, url: string): { text: string; byline: string | null } {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const parsed = new Readability(dom.window.document).parse();
  return { text: cleanArticle(parsed?.textContent ?? ""), byline: parsed?.byline?.trim() || null };
}

/**
 * A subscriber page: its own teaser plus the offer (seen on 2026-11-26: Yahoo Finance Plus pages for MT Newswires
 * stories, "Keep reading this article with Yahoo Finance Plus"). Only a short page with such a line counts; a full
 * article may carry a subscription line in its footer.
 */
const PAYWALL = /keep reading this article with|already a subscriber\?|subscribe to (continue|keep) reading|this (article|content) is (only )?(available )?(for|to) subscribers/i;
const PAYWALL_MAX_CHARS = 2500;

/** Page clutter Readability keeps: repeated "Loading..." placeholders. */
export function cleanArticle(text: string): string {
  return text.replace(/(?:Loading\.\.\.){2,}/g, " ").replace(/\s+/g, " ").trim();
}

/** Judges a fetched text: ok only when long enough, not a subscriber page, and about the headline. */
export function judgeArticle(title: string, text: string): { ok: boolean; overlap: number; reason: string | null } {
  const overlap = Number(headlineOverlap(title, text).toFixed(2));
  if (text.length < ARTICLE_MIN_CHARS) return { ok: false, overlap, reason: "too short" };
  if (text.length < PAYWALL_MAX_CHARS && PAYWALL.test(text)) return { ok: false, overlap, reason: "subscriber page" };
  if (overlap < ARTICLE_MIN_OVERLAP) return { ok: false, overlap, reason: "not about the headline" };
  return { ok: true, overlap, reason: null };
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const agent = new Agent({ maxHeaderSize: 256 * 1024 });

/** Fetches one story's page and judges it. Never throws: a failure is a record with its reason. */
export async function fetchArticle(storyId: string, url: string, title: string, now: () => Date = () => new Date()): Promise<ArticleRecord> {
  const base = { schemaVersion: ARTICLE_SCHEMA_VERSION, storyId, url, fetchedAt: now().toISOString(), finalUrl: null, status: 0, ok: false, chars: 0, overlap: 0, byline: null, sha256: null, text: "" };
  const skip = skipReason(url);
  if (skip) return { ...base, reason: `skipped: ${skip}` };
  try {
    const response = await undiciFetch(url, {
      dispatcher: agent, redirect: "follow", signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" },
    });
    if (!response.ok) return { ...base, finalUrl: response.url, status: response.status, reason: `HTTP ${response.status}` };
    const html = (await response.text()).slice(0, 5_000_000);
    const { text, byline } = readableText(html, response.url);
    const judged = judgeArticle(title, text);
    const kept = judged.ok ? text.slice(0, ARTICLE_KEEP_CHARS) : "";
    return { ...base, finalUrl: response.url, status: response.status, ok: judged.ok, reason: judged.reason, chars: text.length, overlap: judged.overlap, byline,
      sha256: judged.ok ? createHash("sha256").update(kept).digest("hex") : null, text: kept };
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return { ...base, reason: `error: ${cause ?? String((error as Error).message ?? error).slice(0, 100)}` };
  }
}
