import { describe, expect, it } from "vitest";
import { cleanArticle, headlineOverlap, judgeArticle, readableText, skipReason } from "./news-article";
import { itemsBlock, sourceText, type BriefInput } from "./news-briefs";

const body = "Acme Corp said on Wednesday that it agreed to buy Globex for $4.4 billion in cash, its largest deal. ".repeat(8);

describe("article text for the briefs", () => {
  it("skips the hosts measured not to give an article, and Seeking Alpha's paywalled opinion pieces", () => {
    expect(skipReason("https://news.google.com/rss/articles/CBMiabc?oc=5")).toMatch(/redirect/);
    expect(skipReason("https://www.nasdaq.com/articles/acme")).toMatch(/403/);
    expect(skipReason("https://seekingalpha.com/article/4967127-acme")).toMatch(/paywall/);
    expect(skipReason("https://seekingalpha.com/news/4500000-acme-buys-globex")).toBeNull();
    expect(skipReason("https://finance.yahoo.com/news/acme-buys-globex-120000000.html")).toBeNull();
  });

  it("takes a text only when it is long enough and about the headline", () => {
    expect(headlineOverlap("Acme agrees to buy Globex", body)).toBeCloseTo(2 / 3);     // "agrees" is not "agreed"
    expect(judgeArticle("Acme agrees to buy Globex for $4.4 billion", body)).toMatchObject({ ok: true });
    expect(judgeArticle("Acme agrees to buy Globex", "Acme agreed to buy Globex.")).toMatchObject({ ok: false, reason: "too short" });
    expect(judgeArticle("Initech recalls printers after fires", body)).toMatchObject({ ok: false, reason: "not about the headline" });
    const teaser = `MT Newswires 1 min read Acme Corp and Globex are in talks to buy ... Keep reading this article with Yahoo Finance Plus Silver Upgrade to Silver ${"Premium news ".repeat(40)}`;
    expect(judgeArticle("Acme Corp, Globex in talks", teaser)).toMatchObject({ ok: false, reason: "subscriber page" });
    expect(judgeArticle("Acme agrees to buy Globex for $4.4 billion", `${body.repeat(4)} Already a subscriber? Sign in`)).toMatchObject({ ok: true });
    expect(cleanArticle("Published Nov 25Loading...Loading...Loading...S&P is reviewing")).toBe("Published Nov 25 S&P is reviewing");
  });

  it("reads the article out of a page, without its navigation", () => {
    const html = `<html><head><title>x</title></head><body><nav>Home News Finance Sports</nav><article><h1>Acme buys Globex</h1><p>${body}</p><p>${body}</p></article></body></html>`;
    const { text } = readableText(html, "https://example.com/acme");
    expect(text).toContain("agreed to buy Globex");
    expect(text).not.toContain("Home News Finance");
  });

  it("shows the model the start of the article, and the checks read exactly that", () => {
    const story = { id: "s1", title: "Acme buys Globex", url: "u", publisher: "Wire", feed: "wire", publishedAt: "2026-11-25T14:00:00Z", firstSeenAt: "2026-11-25T14:01:00Z", sources: [], copies: 0, companies: [], secItems: [], reading: null };
    const withText: BriefInput = { story, summary: "short summary", article: "A".repeat(1400) + " Initech " + "B".repeat(400) };
    expect(itemsBlock([withText])).toContain("Article: AAAA");
    expect(sourceText(withText)).toContain("Initech");
    expect(sourceText(withText)).not.toContain("BBBB".repeat(30));                       // cut at 1,500 characters
    expect(sourceText({ story, summary: "short summary" })).toBe("Acme buys Globex\nshort summary");
  });
});
