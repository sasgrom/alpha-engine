import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DESK_NEWS_SCHEMA_VERSION, type DeskNewsStory } from "@contracts/desk-news";
import { companyNews, newsPage } from "./desk-news";

const story = (id: string, publishedAt: string, over: Partial<DeskNewsStory> = {}): DeskNewsStory => ({
  id, title: `Story ${id}`, url: `https://x/${id}`, publisher: "GlobeNewswire", feed: "globenewswire-public", publishedAt, firstSeenAt: publishedAt,
  sources: [], copies: 0, companies: [{ cik: 1, ticker: "ACME", name: "Acme Corp", ties: ["subject"], registry: true }], secItems: [],
  reading: { subject: "Acme", eventType: "guidance_outlook", direction: "positive", novelty: "new", fact: "Acme raises outlook." }, ...over,
});

function root() {
  const dir = mkdtempSync(path.join(tmpdir(), "desk-news-"));
  mkdirSync(path.join(dir, "days"));
  mkdirSync(path.join(dir, "company"));
  writeFileSync(path.join(dir, "days", "2026-11-25.json"), JSON.stringify({ schemaVersion: DESK_NEWS_SCHEMA_VERSION, date: "2026-11-25", builtAt: "2026-11-25T12:00:00Z", stories: [
    story("a", "2026-11-25T11:00:00.000Z", { copies: 2 }),
    story("b", "2026-11-25T10:00:00.000Z", { publisher: "Benzinga", companies: [{ cik: 9, ticker: "PRIV", name: "Private", ties: ["subject"], registry: false }], reading: { subject: "Private", eventType: "mna_deal", direction: "negative", novelty: "followup", fact: "x" } }),
    story("old", "2026-11-20T10:00:00.000Z"),
  ] }));
  writeFileSync(path.join(dir, "company", "1.json"), JSON.stringify({ schemaVersion: DESK_NEWS_SCHEMA_VERSION, cik: 1, builtAt: "2026-11-25T12:00:00Z", days: ["2026-11-25"], stories: [story("a", "2026-11-25T11:00:00.000Z")] }));
  return dir;
}
const now = new Date("2026-11-25T12:30:00Z");
const base = { hours: 24, scope: "all" as const, limit: 50 };

describe("desk news service", () => {
  it("shows the window's stories newest first, with counts", () => {
    const page = newsPage(base, true, now, root());
    expect(page.stories.map(row => row.id)).toEqual(["a", "b"]);
    expect(page).toMatchObject({ total: 2, matching: 2, read: 2, copies: 2, builtAt: "2026-11-25T12:00:00Z" });
    expect(page.companies).toEqual([{ cik: 1, ticker: "ACME", name: "Acme Corp", stories: 1, positive: 1, negative: 0 }]);
  });

  it("filters by scope, the model's fields and words", () => {
    const dir = root();
    expect(newsPage({ ...base, scope: "registry" }, true, now, dir).stories.map(row => row.id)).toEqual(["a"]);
    expect(newsPage({ ...base, scope: "watchlist", ciks: [9] }, true, now, dir).stories.map(row => row.id)).toEqual(["b"]);
    expect(newsPage({ ...base, newOnly: true }, true, now, dir).stories.map(row => row.id)).toEqual(["a"]);
    expect(newsPage({ ...base, event: "mna_deal" }, true, now, dir).stories.map(row => row.id)).toEqual(["b"]);
    expect(newsPage({ ...base, search: "acme" }, true, now, dir).stories.map(row => row.id)).toEqual(["a"]);
  });

  it("withholds the model's readings from members, and its filters with them", () => {
    const dir = root();
    const page = newsPage({ ...base, event: "mna_deal" }, false, now, dir);
    expect(page.readings).toBe(false);
    expect(page.stories.map(row => [row.id, row.reading])).toEqual([["a", null], ["b", null]]);
    expect(page.events).toEqual([]);
    expect(page.companies[0]).toMatchObject({ positive: 0, negative: 0 });
    expect(companyNews(1, false, dir)?.stories[0].reading).toBeNull();
    expect(companyNews(1, true, dir)?.stories[0].reading?.direction).toBe("positive");
    expect(companyNews(2, true, dir)).toBeNull();
  });
});
