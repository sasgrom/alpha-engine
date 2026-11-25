/**
 * Stories for the desk from the news archive: the items of one first-seen day grouped by story (copies across
 * outlets share a storyId), each tied to the companies it concerns, with the local model's reading of its first item.
 * Pure: scripts/build-desk-news.mts reads and writes the files.
 */
import type { DeskNewsStory, NewsCompanyTie, NewsReading, NewsTie } from "../../contracts/desk-news";
import type { CompanyEntry } from "./news-companies";

export interface ArchiveItem {
  id: string; feed: string; publisher: string; url: string; title: string; publishedAt: string | null; firstSeenAt: string;
  query?: { ticker?: string; cik?: number } | null; tickers?: string[]; ciks?: number[]; secItems?: string[];
  storyId: string; copyOfEarlierStory: boolean;
}
export interface ArchiveReading {
  id: string; valid: boolean;
  label?: { subject?: string; eventType?: string; direction?: string; novelty?: string; fact?: string };
  subject?: { cik: number } | null;
  mentioned?: { name: string; resolved: { cik: number } | null }[];
}
export interface ArchiveMention { id: string; cik?: number; ticker?: string }

const MAX_SOURCES = 12;
const TIE_ORDER: NewsTie[] = ["subject", "filer", "tagged", "mentioned", "asked"];

/** Google News appends " - Outlet" to its titles; the outlet is already the publisher. */
export function cleanTitle(title: string, publisher: string): string {
  const suffix = ` - ${publisher}`;
  return publisher && title.endsWith(suffix) && title.length > suffix.length + 10 ? title.slice(0, -suffix.length) : title;
}

export function readingOf(row: ArchiveReading | undefined): NewsReading | null {
  const label = row?.valid ? row.label : undefined;
  if (!label?.eventType || !label.direction || !label.novelty) return null;
  return { subject: label.subject ?? "-", eventType: label.eventType, direction: label.direction as NewsReading["direction"], novelty: label.novelty as NewsReading["novelty"], fact: label.fact ?? "" };
}

export interface StoryInputs {
  /** Items first seen on the day, plus later items that may be copies of its stories. */
  items: ArchiveItem[];
  /** The day being built (UTC date): only stories whose first item was seen that day. */
  date: string;
  /** The model's readings by item id (the last valid row wins). */
  readings: Map<string, ArchiveReading>;
  /** Per-company feeds that returned an item already stored, by item id. */
  mentions: Map<string, ArchiveMention[]>;
  companies: Map<number, CompanyEntry>;
  tickerToCik: Map<string, number>;
  registry: Set<number>;
}

export function buildStories(input: StoryInputs): DeskNewsStory[] {
  const groups = new Map<string, ArchiveItem[]>();
  for (const item of input.items) {
    const list = groups.get(item.storyId) ?? [];
    list.push(item);
    groups.set(item.storyId, list);
  }
  const stories: DeskNewsStory[] = [];
  for (const [storyId, list] of groups) {
    list.sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
    const head = list.find(item => item.id === storyId) ?? list[0];
    if (head.firstSeenAt.slice(0, 10) !== input.date) continue;   // a copy of a story of another day
    const copies = list.filter(item => item !== head && item.firstSeenAt >= head.firstSeenAt);
    const ties = new Map<number, Set<NewsTie>>();
    const tie = (cik: number | null | undefined, kind: NewsTie) => { if (!cik || !Number.isInteger(cik)) return; const set = ties.get(cik) ?? new Set(); set.add(kind); ties.set(cik, set); };
    for (const item of [head, ...copies]) {
      for (const cik of item.ciks ?? []) tie(cik, "filer");
      for (const ticker of item.tickers ?? []) tie(input.tickerToCik.get(ticker.toUpperCase().replace("-", ".")), "tagged");
      tie(item.query?.cik, "asked");
      for (const mention of input.mentions.get(item.id) ?? []) tie(mention.cik, "asked");
    }
    const row = input.readings.get(head.id);
    const reading = readingOf(row);
    if (reading) {
      tie(row?.subject?.cik, "subject");
      for (const other of row?.mentioned ?? []) tie(other.resolved?.cik, "mentioned");
    }
    const companies: NewsCompanyTie[] = [...ties].map(([cik, kinds]) => {
      const entry = input.companies.get(cik);
      return { cik, ticker: entry?.tickers[0] ?? null, name: entry?.names[0] ?? null, ties: TIE_ORDER.filter(kind => kinds.has(kind)), registry: input.registry.has(cik) };
    }).sort((a, b) => TIE_ORDER.indexOf(a.ties[0]) - TIE_ORDER.indexOf(b.ties[0]) || a.cik - b.cik);
    const published = head.publishedAt && head.publishedAt <= head.firstSeenAt ? head.publishedAt : head.publishedAt ? head.firstSeenAt : null;
    stories.push({
      id: storyId, title: cleanTitle(head.title, head.publisher), url: head.url, publisher: head.publisher, feed: head.feed,
      publishedAt: published, firstSeenAt: head.firstSeenAt,
      sources: copies.slice(0, MAX_SOURCES).map(item => ({ publisher: item.publisher, feed: item.feed, url: item.url, firstSeenAt: item.firstSeenAt })),
      copies: copies.length, companies, secItems: head.secItems ?? [], reading,
    });
  }
  return stories.sort((a, b) => (b.publishedAt ?? b.firstSeenAt).localeCompare(a.publishedAt ?? a.firstSeenAt) || a.id.localeCompare(b.id));
}

/** The stories of one registry company, newest first: those it is tied to in any way. */
export function companyStories(stories: DeskNewsStory[], cik: number, limit = 400): DeskNewsStory[] {
  return stories.filter(story => story.companies.some(company => company.cik === cik))
    .sort((a, b) => (b.publishedAt ?? b.firstSeenAt).localeCompare(a.publishedAt ?? a.firstSeenAt)).slice(0, limit);
}
