import { describe, expect, it } from "vitest";
import { buildStories, cleanTitle, companyStories, readingOf, type ArchiveItem, type StoryInputs } from "./desk-news";

const item = (id: string, over: Partial<ArchiveItem> = {}): ArchiveItem => ({
  id, feed: "globenewswire-public", publisher: "GlobeNewswire", url: `https://x/${id}`, title: `Acme raises its outlook for the year ${id}`,
  publishedAt: "2026-11-25T10:00:00.000Z", firstSeenAt: "2026-11-25T10:01:00.000Z", storyId: id, copyOfEarlierStory: false, ...over,
});
const inputs = (items: ArchiveItem[], over: Partial<StoryInputs> = {}): StoryInputs => ({
  items, date: "2026-11-25", readings: new Map(), mentions: new Map(),
  companies: new Map([[1, { cik: 1, tickers: ["ACME"], names: ["Acme Corp"] }], [2, { cik: 2, tickers: ["GLBX"], names: ["Globex Inc"] }]]),
  tickerToCik: new Map([["ACME", 1], ["GLBX", 2]]), registry: new Set([1]), ...over,
});

describe("desk news stories", () => {
  it("joins copies to the first item and keeps who carried it and when", () => {
    const stories = buildStories(inputs([
      item("a", { tickers: ["ACME"] }),
      item("b", { publisher: "Benzinga", feed: "benzinga", storyId: "a", copyOfEarlierStory: true, firstSeenAt: "2026-11-25T10:20:00.000Z" }),
      item("c", { publisher: "Yahoo", feed: "yahoo-headlines", storyId: "a", copyOfEarlierStory: true, firstSeenAt: "2026-11-26T01:00:00.000Z", query: { ticker: "GLBX", cik: 2 } }),
    ]));
    expect(stories).toHaveLength(1);
    expect(stories[0]).toMatchObject({ id: "a", publisher: "GlobeNewswire", copies: 2 });
    expect(stories[0].sources.map(source => source.publisher)).toEqual(["Benzinga", "Yahoo"]);
    expect(stories[0].companies).toEqual([
      { cik: 1, ticker: "ACME", name: "Acme Corp", ties: ["tagged"], registry: true },
      { cik: 2, ticker: "GLBX", name: "Globex Inc", ties: ["asked"], registry: false },
    ]);
  });

  it("builds only the stories first seen on the day", () => {
    const stories = buildStories(inputs([item("a"), item("d", { firstSeenAt: "2026-11-26T00:10:00.000Z" })]));
    expect(stories.map(story => story.id)).toEqual(["a"]);
  });

  it("adds the model's reading and its companies, and never a publication time after first sight", () => {
    const readings = new Map([["a", { id: "a", valid: true, label: { subject: "Acme", eventType: "guidance_outlook", direction: "positive", novelty: "new", fact: "Acme raises outlook." }, subject: { cik: 1 }, mentioned: [{ name: "Globex", resolved: { cik: 2 } }] }]]);
    const [story] = buildStories(inputs([item("a", { publishedAt: "2026-11-25T11:00:00.000Z" })], { readings }));
    expect(story.reading).toEqual({ subject: "Acme", eventType: "guidance_outlook", direction: "positive", novelty: "new", fact: "Acme raises outlook." });
    expect(story.companies.map(company => [company.cik, company.ties])).toEqual([[1, ["subject"]], [2, ["mentioned"]]]);
    expect(story.publishedAt).toBe("2026-11-25T10:01:00.000Z");
    expect(readingOf({ id: "a", valid: false, label: {} })).toBeNull();
  });

  it("ties a company whose feed returned a stored item, and lists a company's stories newest first", () => {
    const mentions = new Map([["a", [{ id: "a", cik: 1, ticker: "ACME" }]]]);
    const stories = buildStories(inputs([item("a"), item("e", { publishedAt: "2026-11-25T12:00:00.000Z", firstSeenAt: "2026-11-25T12:00:00.000Z", ciks: [1] })], { mentions }));
    expect(companyStories(stories, 1).map(story => [story.id, story.companies[0].ties])).toEqual([["e", ["filer"]], ["a", ["asked"]]]);
    expect(companyStories(stories, 2)).toEqual([]);
  });

  it("drops the outlet Google News appends to a title", () => {
    expect(cleanTitle("AbbVie raises its dividend by 5.2% this year - Yahoo Finance", "Yahoo Finance")).toBe("AbbVie raises its dividend by 5.2% this year");
    expect(cleanTitle("Short - Reuters", "Reuters")).toBe("Short - Reuters");
  });
});
