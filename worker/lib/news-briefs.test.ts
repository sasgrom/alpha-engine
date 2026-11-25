import { describe, expect, it } from "vitest";
import type { DeskNewsStory, NewsTie } from "../../contracts/desk-news";
import { briefAction, buildPoints, checkAgainst, checkedTopLine, etClock, etInstant, numbersIn, openThreads, ordinaryWords, parseMorning, pickStories, previousWeekday, staleResults } from "./news-briefs";

const story = (id: string, ties: [number, NewsTie[]][], reading: DeskNewsStory["reading"]): DeskNewsStory => ({
  id, title: `Title ${id}`, url: "https://example.com", publisher: "Wire", feed: "wire", publishedAt: null, firstSeenAt: "2026-11-25T12:00:00Z",
  sources: [], copies: 0, companies: ties.map(([cik, list]) => ({ cik, ticker: null, name: null, ties: list, registry: true })), secItems: [], reading,
});
const read = (eventType: string, novelty: "new" | "followup" | "noise") => ({ subject: "Acme", eventType, direction: "neutral" as const, novelty, fact: "" });

describe("news briefs", () => {
  it("picks filings and real news about the company, and counts the rest", () => {
    const stories = [
      story("filing", [[1, ["filer"]]], null),
      story("new", [[1, ["subject", "asked"]]], read("guidance_outlook", "new")),
      story("call", [[1, ["subject"]]], read("earnings_results", "followup")),
      story("opinion", [[1, ["subject"]]], read("product_business", "followup")),
      story("listicle", [[1, ["subject"]]], read("market_commentary", "new")),
      story("promo", [[1, ["subject"]]], read("other", "noise")),
      story("other subject", [[1, ["tagged"]], [2, ["subject"]]], read("contract_partnership", "new")),
      story("tagged", [[1, ["tagged"]]], read("contract_partnership", "new")),
      story("asked only", [[1, ["asked"]]], read("mna_deal", "new")),
      story("unread", [[1, ["asked"]]], null),
      story("not tied", [[3, ["subject"]]], read("mna_deal", "new")),
      story("fund bot", [[1, ["subject"]]], read("insider_ownership", "new")),
      { ...story("question", [[1, ["subject"]]], read("mna_deal", "new")), title: "Acme's $4.4B Asset Sale: Can It Boost Shareholder Returns?" },
      { ...story("list", [[1, ["subject"]]], read("capital_return", "new")), title: "How Buffett Makes Billions from Dividends: Top 5 Stocks" },
      { ...story("asks mid-title", [[1, ["subject"]]], read("analyst_action", "new")), title: "104% Upside for Acme? Bernstein Thinks So" },
      { ...story("comparison", [[1, ["subject"]]], read("capital_return", "new")), title: "Acme Pays a Bigger Dividend, but Globex May Be the Better Retirement Stock" },
      { ...story("versus", [[1, ["subject"]]], read("product_business", "new")), title: "Acme vs. Globex: Which Stock Is a Better Buy for 2027" },
    ];
    const result = pickStories(stories, 1);
    expect(result.picked.map(item => item.id)).toEqual(["filing", "new", "call", "tagged", "asks mid-title"]);
    expect(result.skipped).toEqual({ old: 0, "not about it": 2, noise: 1, commentary: 5, holdings: 1, "follow-up": 1, unread: 1 });
  });

  it("leaves out a results story between reports, not around one", () => {
    const results = { ...story("q3", [[1, ["subject"]]], read("earnings_results", "new")), publishedAt: "2026-11-25T12:00:00Z" };
    expect(staleResults(results, { lastEarnings: "2026-10-31", nextEarnings: "2027-01-30" })).toBe(true);
    expect(staleResults(results, { lastEarnings: "2026-11-20", nextEarnings: "2027-02-20" })).toBe(false);
    expect(staleResults(results, { lastEarnings: "2026-08-20", nextEarnings: "2026-12-01" })).toBe(false);
    expect(staleResults(results, {})).toBe(false);
    expect(pickStories([results], 1, undefined, { lastEarnings: "2026-10-31", nextEarnings: "2027-01-30" }).skipped.commentary).toBe(1);
  });

  it("counts a story published well before the window as old, though first seen inside it", () => {
    const late = { ...story("late", [[1, ["subject"]]], read("mna_deal", "new")), publishedAt: "2026-11-24T14:00:00Z" };
    const edge = { ...story("edge", [[1, ["subject"]]], read("mna_deal", "new")), publishedAt: "2026-11-24T20:50:00Z" };
    const result = pickStories([late, edge], 1, "2026-11-24T21:00:00.000Z");
    expect(result.picked.map(item => item.id)).toEqual(["edge"]);
    expect(result.skipped.old).toBe(1);
  });

  it("times the brief in New York time, across daylight saving", () => {
    expect(etClock(new Date("2026-11-25T13:45:00Z"))).toEqual({ date: "2026-11-25", weekday: 3, minutes: 8 * 60 + 45 });
    expect(etInstant("2026-11-24", 16 * 60).toISOString()).toBe("2026-11-24T21:00:00.000Z");
    expect(etInstant("2026-07-01", 16 * 60).toISOString()).toBe("2026-07-01T20:00:00.000Z");
    expect(previousWeekday("2026-11-30")).toBe("2026-11-27");
    expect(briefAction(new Date("2026-11-25T13:40:00Z"), false)).toMatchObject({ kind: "none" });
    expect(briefAction(new Date("2026-11-25T13:50:00Z"), false)).toEqual({ kind: "morning", edition: "2026-11-25", from: "2026-11-24T21:00:00.000Z", waitForReader: true });
    expect(briefAction(new Date("2026-11-30T15:00:00Z"), false)).toEqual({ kind: "morning", edition: "2026-11-30", from: "2026-11-27T21:00:00.000Z", waitForReader: false });
    expect(briefAction(new Date("2026-11-25T18:00:00Z"), true)).toEqual({ kind: "update", edition: "2026-11-25" });
    expect(briefAction(new Date("2026-11-26T01:30:00Z"), true)).toMatchObject({ kind: "none" });
    expect(briefAction(new Date("2026-11-28T15:00:00Z"), false)).toMatchObject({ kind: "none" });
  });

  it("finds numbers and names the sources do not state", () => {
    expect(numbersIn("Sales rose 6% to $1,250.5 million in 2026; split 10:1.")).toEqual([6, 1250.5, 2026, 10, 1]);
    const sources = ["ASML Sinks 6% in Chip Rout as Dutch Lawmaker Warns MATCH Act Is Disastrous", "Shares fell 6.0% on Wednesday."];
    expect(checkAgainst("ASML fell 6% after a Dutch lawmaker criticised the MATCH Act.", sources, ["ASML Holding N.V."]).ok).toBe(true);
    expect(checkAgainst("ASML fell 7% after Intel warned.", sources)).toEqual({ ok: false, numbers: [7], names: ["Intel"] });
    expect(checkAgainst("Shares fell 6% on Wednesday in November.", sources).ok).toBe(true);
  });

  it("reads possessives and ordinary words in Title Case without taking them for names", () => {
    const sources = ["Eli Lilly earns Moody’s upgrade to Aa2 as obesity drug demand fuels earnings", "the outlook of an analyst; another analyst outlook; outlook and analyst"];
    expect(checkAgainst("Eli Lilly's rating upgraded by Moody's to Aa2.", sources).ok).toBe(true);
    const ordinary = ordinaryWords(sources);
    expect(ordinary.has("outlook") && ordinary.has("analyst")).toBe(true);
    expect(checkAgainst("BMO Analyst Outlook for Lilly", ["BMO expects a Lilly beat"], [], ordinary).ok).toBe(true);
    expect(checkAgainst("Pfizer Analyst Outlook for Lilly", ["BMO expects a Lilly beat"], [], ordinary)).toMatchObject({ ok: false, names: ["Pfizer"] });
  });

  it("turns the model's answer into checked points on threads, and keeps a thread open for 72 hours", () => {
    const inputs = [
      { story: { ...story("s1", [[1, ["subject"]]], read("legal_regulatory", "new")), title: "Acme sued over patents", publishedAt: "2026-11-25T12:00:00Z" }, summary: "A court case was filed on Tuesday." },
      { story: { ...story("s2", [[1, ["subject"]]], read("guidance_outlook", "new")), title: "Acme cuts its outlook to $2 billion" }, summary: "" },
    ];
    const threads = [{ id: "old-thread", title: "Patent fight", text: "Globex sued Acme.", lastAt: "2026-11-24T15:00:00Z", since: "2026-11-23T10:00:00Z" }];
    const answer = parseMorning(JSON.stringify({ topLine: "Acme cuts its outlook to $2 billion.", points: [
      { thread: "T1", title: "Patent case", text: "A court case was filed on Tuesday.", items: ["S1", "S9"] },
      { thread: "new", title: "Outlook cut", text: "Acme cut its outlook to $3 billion.", items: ["S2"] },
      { thread: "new", title: "Nothing cited", text: "x", items: ["S7"] },
    ] }))!;
    const context = { names: ["Acme Corp"], ordinary: new Set<string>() };
    const points = buildPoints(answer, inputs, threads, context);
    expect(points.map(point => [point.thread, point.continues, point.since, point.checked])).toEqual([["old-thread", true, "2026-11-23T10:00:00Z", true], ["s2", false, "2026-11-25T12:00:00Z", false]]);
    expect(points[1]).toMatchObject({ title: "Acme cuts its outlook to $2 billion", text: "", problems: ["number 3 not in the sources"] });
    expect(checkedTopLine(answer.topLine, inputs, context, "fallback")).toEqual({ text: "Acme cuts its outlook to $2 billion.", checked: true });
    expect(parseMorning("{\"topLine\": 3}")).toBeNull();

    const brief = { points: [{ ...points[0], sources: [{ id: "s1", title: "", publisher: "", url: "", at: "2026-11-25T12:00:00Z" }] }], updates: [], generatedAt: "2026-11-25T13:45:00Z" } as never;
    expect(openThreads([brief], new Date("2026-11-28T11:00:00Z")).map(thread => thread.id)).toEqual(["old-thread"]);
    expect(openThreads([brief], new Date("2026-11-28T13:00:00Z"))).toEqual([]);
  });

  it("accepts a spelled-out abbreviation or small number the sources state, and nothing else", () => {
    expect(checkAgainst("The European Union delayed a vote; thirteen funds bought.", ["EU delays vote", "13 big funds bought"]).ok).toBe(true);
    expect(checkAgainst("The United Kingdom raised a tax.", ["EU delays vote"])).toMatchObject({ ok: false, names: ["United", "Kingdom"] });
    expect(checkAgainst("Fourteen funds sold.", ["13 big funds bought"])).toMatchObject({ ok: false, names: ["Fourteen"] });
  });
});
