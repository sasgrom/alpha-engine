import { describe, expect, it } from "vitest";
import { canonicalUrl, companyGap, feedTags, normalizeTitle, parseFeed, sameStory, StoryIndex } from "./news-feeds";

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>x</title>
<item>
  <guid
    isPermaLink="true">https://www.globenewswire.com/news-release/2026/11/25/3410027/0/en/acme.html</guid>
  <link>https://www.globenewswire.com/news-release/2026/11/25/3410027/0/en/acme.html</link>
  <category
    domain="https://www.globenewswire.com/rss/stock">NASDAQ:ACME</category>
  <category domain="https://www.globenewswire.com/rss/ISIN">US0000000001</category>
  <title>Acme Corp Reports Third Quarter 2026 Results &amp; Raises Guidance</title>
  <description><![CDATA[<p>Revenue rose 12%&nbsp;to $1.2 billion</p>]]></description>
  <pubDate>Wed, 25 Nov 2026 08:48 GMT</pubDate>
  <dc:contributor>Acme Corp</dc:contributor>
</item>
<item><title>Apple shares rise after iPhone sales beat - Reuters</title><link>https://news.google.com/rss/articles/abc?oc=5</link><guid isPermaLink="false">CBMiabc</guid><pubDate>Tue, 24 Nov 2026 20:53:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
</channel></rss>`;
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
<title>8-K - American Resources Corp (0001590715) (Filer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1590715/000147793226007287/0001477932-26-007287-index.htm"/>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-11-24 &lt;br&gt;Item 4.02: Non-Reliance &lt;br&gt;Item 9.01: Financial Statements and Exhibits</summary>
<updated>2026-11-24T17:30:36-05:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="8-K"/>
<id>urn:tag:sec.gov,2008:accession-number=0001477932-26-007287</id>
</entry></feed>`;

describe("news feed parsing", () => {
  it("reads RSS items with CDATA, entities, split attributes and categories", () => {
    const [wire, google] = parseFeed(RSS);
    expect(wire).toMatchObject({ guid: "https://www.globenewswire.com/news-release/2026/11/25/3410027/0/en/acme.html", title: "Acme Corp Reports Third Quarter 2026 Results & Raises Guidance", summary: "Revenue rose 12% to $1.2 billion", publishedAt: "2026-11-25T08:48:00.000Z", contributor: "Acme Corp" });
    expect(wire.categories).toEqual([{ domain: "https://www.globenewswire.com/rss/stock", value: "NASDAQ:ACME" }, { domain: "https://www.globenewswire.com/rss/ISIN", value: "US0000000001" }]);
    expect(google).toMatchObject({ guid: "CBMiabc", publisher: "Reuters", publishedAt: "2026-11-24T20:53:00.000Z" });
  });

  it("reads Atom entries and the SEC's filer CIK and 8-K items", () => {
    const [entry] = parseFeed(ATOM);
    expect(entry).toMatchObject({ url: "https://www.sec.gov/Archives/edgar/data/1590715/000147793226007287/0001477932-26-007287-index.htm", publishedAt: "2026-11-24T22:30:36.000Z" });
    expect(entry.guid).toContain("0001477932-26-007287");
    expect(feedTags("sec-8k-current", entry)).toMatchObject({ ciks: [1590715], secItems: ["4.02", "9.01"] });
  });

  it("takes exchange tickers and ISINs from wire categories, nothing from other categories", () => {
    const [wire] = parseFeed(RSS);
    expect(feedTags("globenewswire-public", wire)).toEqual({ tickers: ["ACME"], ciks: [], isins: ["US0000000001"], secItems: [] });
    expect(feedTags("x", { ...wire, categories: [{ domain: "https://www.globenewswire.com/rss/stock", value: "Copenhagen:NYK62 10" }] }).tickers).toEqual([]);
  });
});

describe("gaps in per-company feeds", () => {
  const items = (times: (string | null)[]) => times.map((publishedAt, i) => ({ guid: `g${i}`, url: null, title: `t${i}`, summary: "", publishedAt, categories: [], publisher: null, contributor: null }));
  it("flags an answer of at least 10 items that all came after our previous ask", () => {
    const later = Array.from({ length: 12 }, (_, i) => `2026-11-25T${String(10 + i).padStart(2, "0")}:00:00.000Z`);
    expect(companyGap(items(later), "2026-11-25T09:00:00.000Z")).toBe(true);
    expect(companyGap(items(later), "2026-11-25T12:30:00.000Z")).toBe(false);
    expect(companyGap(items(later.slice(0, 9)), "2026-11-25T09:00:00.000Z")).toBe(false);
    expect(companyGap(items([...later, null]), "2026-11-25T09:00:00.000Z")).toBe(false);
    expect(companyGap(items(later), null)).toBe(false);
  });
});

describe("duplicates across sources", () => {
  it("gives one address to the same article with tracking parameters, www, a trailing slash or /amp", () => {
    const a = canonicalUrl("https://www.Example.com/news/acme-results/?utm_source=x&utm_medium=rss&id=7");
    expect(a).toBe("example.com/news/acme-results?id=7");
    expect(canonicalUrl("https://example.com/news/acme-results/amp?id=7#top")).toBe(a);
    expect(canonicalUrl("not a url")).toBeNull();
  });

  it("strips the publisher tail Google News adds and the punctuation outlets change", () => {
    expect(normalizeTitle("Apple shares rise after iPhone sales beat - Reuters", "Reuters")).toBe("apple shares rise after iphone sales beat");
    expect(normalizeTitle("Apple’s shares RISE, after iPhone sales beat!")).toBe("apples shares rise after iphone sales beat");
    expect(normalizeTitle("Revenue up 12.5% to $1.2 billion.")).toBe("revenue up 12.5% to $1.2 billion");
  });

  it("joins copies that differ in filler words and keeps another company's identical headline apart", () => {
    const t = (title: string) => normalizeTitle(title);
    expect(sameStory(t("Acme Corp Reports Third Quarter 2026 Results and Raises Full-Year Guidance"), t("Acme Corp Reports Third Quarter 2026 Results, Raises Full-Year Guidance"))).toBe(true);
    expect(sameStory(t("Nvidia stock jumps after record data center revenue beats estimates"), t("Nvidia stock jumps after record data-center revenue beats estimates"))).toBe(true);
    expect(sameStory(t("Acme Corp Reports Third Quarter 2026 Results and Raises Full-Year Guidance"), t("Globex Corp Reports Third Quarter 2026 Results and Raises Full-Year Guidance"))).toBe(false);
    expect(sameStory(t("Acme raises guidance for 2026 on strong demand"), t("Acme cuts guidance for 2026 on weak demand"))).toBe(false);
    expect(sameStory(t("Acme results"), t("Acme results"))).toBe(true);
    expect(sameStory(t("Acme beats"), t("Acme beats estimates"))).toBe(false);
  });

  it("finds a story by address, title or a copy, among recent stories", () => {
    const base = normalizeTitle("Acme Corp Reports Third Quarter 2026 Results and Raises Full-Year Guidance");
    const index = new StoryIndex([{ storyId: "s1", title: base, url: "globenewswire.com/acme", seenAt: "2026-11-25T00:00:00Z" }]);
    expect(index.match(base, null)?.storyId).toBe("s1");
    expect(index.match("something else entirely", "globenewswire.com/acme")?.storyId).toBe("s1");
    expect(index.match(normalizeTitle("Acme Corp Reports Third Quarter 2026 Results, Raises Full-Year Guidance"), "prnewswire.com/acme")?.storyId).toBe("s1");
    expect(index.match(normalizeTitle("Globex Corp Reports Third Quarter 2026 Results and Raises Full-Year Guidance"), null)).toBeNull();
    index.add({ storyId: "s2", title: normalizeTitle("Globex Names New Chief Financial Officer"), url: null, seenAt: "2026-11-25T01:00:00Z" });
    expect(index.match(normalizeTitle("Globex names new chief financial officer"), null)?.storyId).toBe("s2");
  });
});
