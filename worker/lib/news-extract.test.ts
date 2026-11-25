import { describe, expect, it } from "vitest";
import { CompanyIndex } from "./news-companies";
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM, itemText, parseAnswer, pickItems, PROMPT_VERSION, resolveName, tiedCiks, userMessage, type NewsItemRow } from "./news-extract";

const row = (id: string, firstSeenAt: string, copy = false): NewsItemRow => ({ id, feed: "globenewswire-public", publisher: "GlobeNewswire", title: `Title ${id}`, summary: null, firstSeenAt, storyId: copy ? "s0" : id, copyOfEarlierStory: copy });

describe("news extraction", () => {
  it("keeps the prompt the bake-off measured", () => {
    expect(EXTRACT_SYSTEM.startsWith("You label financial news items for a stock research system.")).toBe(true);
    expect(EXTRACT_SCHEMA.required).toEqual(["subject", "mentioned", "eventType", "direction", "novelty", "fact"]);
    // the system text hashes to d950a631… exactly as the bake-off's Python prompt did; a change needs a new bake-off
    expect(PROMPT_VERSION).toBe("b0f0bc360b718996");
  });

  it("gives the model the summary without the repeated title", () => {
    const item = { ...row("a", "2026-11-25T10:00:00Z"), title: "Acme raises its outlook", summary: "Acme raises its outlook.  Acme now expects\n revenue of $2 billion." };
    expect(itemText(item)).toBe("Acme now expects revenue of $2 billion");
    expect(userMessage(item)).toBe("Source: GlobeNewswire (globenewswire-public)\nTitle: Acme raises its outlook\nText: Acme now expects revenue of $2 billion");
    expect(userMessage({ ...item, summary: "" })).toContain("\nText: -");
  });

  it("accepts only complete answers inside the lists", () => {
    const good = { subject: " Acme ", mentioned: ["Globex", "", 3], eventType: "guidance_outlook", direction: "positive", novelty: "new", fact: "Acme raises outlook." };
    expect(parseAnswer(JSON.stringify(good))).toEqual({ subject: "Acme", mentioned: ["Globex"], eventType: "guidance_outlook", direction: "positive", novelty: "new", fact: "Acme raises outlook." });
    expect(parseAnswer(JSON.stringify({ ...good, eventType: "rumour" }))).toBeNull();
    expect(parseAnswer(JSON.stringify({ ...good, mentioned: "Globex" }))).toBeNull();
    expect(parseAnswer("{not json")).toBeNull();
  });

  it("reads one item per story, newest first, and skips what is done", () => {
    const rows = [row("a", "2026-11-25T10:00:00Z"), row("b", "2026-11-25T12:00:00Z"), row("c", "2026-11-25T13:00:00Z", true), row("d", "2026-11-25T11:00:00Z")];
    expect(pickItems(rows, new Set(["d"]), 10).map(item => item.id)).toEqual(["b", "a"]);
    expect(pickItems(rows, new Set(), 1).map(item => item.id)).toEqual(["b"]);
  });

  it("reads items of followed companies first, each group newest first", () => {
    const rows = [row("a", "2026-11-25T10:00:00Z"), row("b", "2026-11-25T12:00:00Z"), row("e", "2026-11-25T09:00:00Z"), row("f", "2026-11-25T08:00:00Z")];
    const followed = (item: NewsItemRow) => item.id === "e" || item.id === "f";
    expect(pickItems(rows, new Set(), 10, followed).map(item => item.id)).toEqual(["e", "f", "b", "a"]);
  });

  it("ties an unread item to its filer, tagged tickers, the asked company and later asks", () => {
    const tickers = new Map([["BRK.B", 1067983], ["AAPL", 320193]]);
    expect(tiedCiks({ query: { cik: 789019 }, ciks: [1], tickers: ["brk-b", "ZZZZ"] }, tickers, [320193]).sort((a, b) => a - b)).toEqual([1, 320193, 789019, 1067983]);
    expect(tiedCiks({}, tickers)).toEqual([]);
  });

  it("resolves names, and a stated ticker only when it shares a word with the name", () => {
    const index = new CompanyIndex([
      { cik: 6281, tickers: ["ADI"], names: ["ANALOG DEVICES INC"] },
      { cik: 1, tickers: ["ANT"], names: ["Antares Widgets Corp"] },
    ]);
    expect(resolveName(index, "Analog Devices", "")).toEqual({ cik: 6281, tickers: ["ADI"], how: "exact" });
    expect(resolveName(index, "Antares", "Antares (Nasdaq: ANT) reports")).toMatchObject({ cik: 1 });
    expect(resolveName(index, "Zeta Partners", "Zeta (Nasdaq: ANT)")).toBeNull();
    expect(resolveName(index, "-", "")).toBeNull();
  });
});
