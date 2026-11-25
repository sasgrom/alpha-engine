/**
 * Reads the desk's news files (scripts/build-desk-news.mts, worker/.runs/desk-news). Day files are kept parsed while
 * their modification time and size are unchanged; only the newest days are kept. The model's readings are our own
 * research product: viewers other than the owner and NDA-accepted reviewers get the stories without them, and
 * cannot filter by them.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DESK_NEWS_SCHEMA_VERSION, type DeskNewsCompany, type DeskNewsDay, type DeskNewsPage, type DeskNewsQuery, type DeskNewsStory } from "@contracts/desk-news";
import { NEWS_BRIEF_SCHEMA_VERSION, type DeskBriefLine, type NewsBrief } from "@contracts/news-briefs";

const MAX_DAYS_CACHED = 5;
const dayCache = new Map<string, { mtimeMs: number; size: number; value: DeskNewsDay }>();

export function deskNewsRoot(): string {
  return path.resolve(process.cwd(), "worker/.runs/desk-news");
}

function readJson<T extends { schemaVersion: number }>(file: string): T | null {
  if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, "utf8")) as T;
  if (value.schemaVersion !== DESK_NEWS_SCHEMA_VERSION) throw new Error(`Desk news file schema ${String(value.schemaVersion)} is not the expected ${DESK_NEWS_SCHEMA_VERSION}; rebuild it`);
  return value;
}

export function readNewsDay(date: string, root = deskNewsRoot()): DeskNewsDay | null {
  const file = path.join(root, "days", `${date}.json`);
  if (!existsSync(file)) return null;
  const { mtimeMs, size } = statSync(file);
  const hit = dayCache.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.value;
  const value = readJson<DeskNewsDay>(file);
  if (!value) return null;
  dayCache.set(file, { mtimeMs, size, value });
  while (dayCache.size > MAX_DAYS_CACHED) dayCache.delete([...dayCache.keys()].sort()[0]);
  return value;
}

const when = (story: DeskNewsStory) => story.publishedAt ?? story.firstSeenAt;
const withoutReading = (story: DeskNewsStory): DeskNewsStory => (story.reading ? { ...story, reading: null } : story);

/** The News page: stories published in the window (newest first), filtered, with counts over the matching ones. */
export function newsPage(query: DeskNewsQuery, readings: boolean, now = new Date(), root = deskNewsRoot()): DeskNewsPage {
  const cutoff = new Date(now.getTime() - query.hours * 3_600_000).toISOString();
  // a story published after the cutoff was first seen after it too, so the first-seen days from the cutoff's day on hold it
  const dates: string[] = [];
  for (let t = Date.parse(`${cutoff.slice(0, 10)}T00:00:00Z`); t <= now.getTime(); t += 86_400_000) dates.push(new Date(t).toISOString().slice(0, 10));
  const days = dates.map(date => readNewsDay(date, root)).filter((day): day is DeskNewsDay => day !== null);
  const inWindow = days.flatMap(day => day.stories).filter(story => when(story) >= cutoff);
  const wanted = query.scope === "watchlist" ? new Set(query.ciks ?? []) : null;
  const search = query.search?.trim().toLowerCase();
  const matching = inWindow.filter(story => {
    if (query.scope === "registry" && !story.companies.some(company => company.registry)) return false;
    if (wanted && !story.companies.some(company => wanted.has(company.cik))) return false;
    if (query.publisher && story.publisher !== query.publisher) return false;
    if (readings && query.event && story.reading?.eventType !== query.event) return false;
    if (readings && query.direction && story.reading?.direction !== query.direction) return false;
    if (readings && query.newOnly && story.reading?.novelty !== "new") return false;
    if (search && !story.title.toLowerCase().includes(search) && !story.companies.some(company => company.ticker?.toLowerCase() === search || company.name?.toLowerCase().includes(search))) return false;
    return true;
  }).sort((a, b) => when(b).localeCompare(when(a)) || a.id.localeCompare(b.id));

  const count = <K>(keys: K[]) => { const map = new Map<K, number>(); for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1); return map; };
  const events = readings ? [...count(matching.flatMap(story => (story.reading ? [story.reading.eventType] : [])))].map(([event, stories]) => ({ event, stories })).sort((a, b) => b.stories - a.stories) : [];
  const publishers = [...count(matching.map(story => story.publisher))].map(([publisher, stories]) => ({ publisher, stories })).sort((a, b) => b.stories - a.stories).slice(0, 25);
  const companies = new Map<number, DeskNewsPage["companies"][number]>();
  for (const story of matching) for (const company of story.companies) {
    if (!company.registry) continue;
    const row = companies.get(company.cik) ?? { cik: company.cik, ticker: company.ticker, name: company.name, stories: 0, positive: 0, negative: 0 };
    row.stories++;
    // the direction belongs to the story's subject: count it only for the company the story is about
    if (readings && company.ties.includes("subject")) {
      if (story.reading?.direction === "positive") row.positive++;
      if (story.reading?.direction === "negative") row.negative++;
    }
    companies.set(company.cik, row);
  }
  const builtAt = days.map(day => day.builtAt).sort().at(-1) ?? null;
  return {
    builtAt, hours: query.hours, total: inWindow.length, matching: matching.length,
    read: matching.filter(story => story.reading).length, copies: matching.reduce((sum, story) => sum + story.copies, 0),
    stories: matching.slice(0, query.limit).map(story => (readings ? story : withoutReading(story))),
    events, publishers,
    companies: [...companies.values()].sort((a, b) => b.stories - a.stories || a.cik - b.cik).slice(0, 15),
    readings,
  };
}

/** A brief is shown while its latest version is at most this old (the owner: short-lived, 2–3 days at most). */
export const BRIEF_SHOWN_HOURS = 72;

/** A followed company's latest news brief (worker/news-briefs.mts); null when there is none or it is older than three days. */
export function readBrief(cik: number, now = new Date(), root = deskNewsRoot()): NewsBrief | null {
  const file = path.join(root, "briefs", `${cik}.json`);
  if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, "utf8")) as NewsBrief;
  if (value.schemaVersion !== NEWS_BRIEF_SCHEMA_VERSION) throw new Error(`News brief schema ${String(value.schemaVersion)} is not the expected ${NEWS_BRIEF_SCHEMA_VERSION}; rebuild it`);
  return Date.parse(value.to) >= now.getTime() - BRIEF_SHOWN_HOURS * 3_600_000 ? value : null;
}

/** The Today page's lines: the latest brief of each given company that has one, newest change first. */
export function briefLines(ciks: number[], now = new Date(), root = deskNewsRoot()): DeskBriefLine[] {
  const lines: DeskBriefLine[] = [];
  for (const cik of new Set(ciks)) {
    const brief = readBrief(cik, now, root);
    if (!brief) continue;
    const lastUpdate = brief.updates.at(-1) ?? null;
    lines.push({ cik, ticker: brief.ticker, name: brief.name, edition: brief.edition, topLine: brief.topLine.text, checked: brief.topLine.checked,
      points: brief.points.length, updates: brief.updates.length,
      changedAt: lastUpdate && lastUpdate.at > brief.topLine.changedAt ? lastUpdate.at : brief.topLine.changedAt, lastUpdate: lastUpdate ? { at: lastUpdate.at, text: lastUpdate.text || lastUpdate.title } : null });
  }
  return lines.sort((a, b) => Number(b.points + b.updates > 0) - Number(a.points + a.updates > 0) || b.changedAt.localeCompare(a.changedAt) || b.points + b.updates - (a.points + a.updates) || a.cik - b.cik);
}

/** One registry company's stories of the covered days; null when the file is not built. */
export function companyNews(cik: number, readings: boolean, root = deskNewsRoot()): DeskNewsCompany | null {
  const value = readJson<DeskNewsCompany>(path.join(root, "company", `${cik}.json`));
  if (!value || readings) return value;
  return { ...value, stories: value.stories.map(withoutReading) };
}
