/**
 * Unit tests for the worker normalizers — pure functions, no network, no DB.
 * Run: npx vitest run worker/lib/worker.test.ts
 */
import { describe, expect, it } from "vitest";
import { toneFromBins, hourBucket, dayBucket, countArticles, buildGdeltRows } from "./gdelt";
import { aggregateStream, buildCrowdRow, buildStocktwitsRows, crowdPrompt } from "./stocktwits";
import { splitCsv, detectKind, artlistToBuzz, timelineToTone } from "./gdelt-csv";
import { extractScore, extractVerdict, isBoilerplateRationale, sanitizeWhy, tonePrompt, generate } from "./ollama";
import { buildDigestPrompt } from "./digest";
import { factsToRows, isThinContent, isPermanentSecMissing, secGet, SecHttpError, shouldScoreManifestEntry, shouldDownloadExhibit } from "./edgar";

describe("ollama: extractScore", () => {
  it("parses clean JSON", () => {
    expect(extractScore('{"score": 0.7}')).toBe(0.7);
    expect(extractScore('{"score": -1}')).toBe(-1);
  });
  it("finds JSON inside chatty replies", () => {
    expect(extractScore('Sure! Here is the rating: {"score": 0.456} hope that helps')).toBe(0.456);
  });
  it("clamps out-of-range and rejects garbage", () => {
    expect(extractScore('{"score": 5}')).toBe(1);
    expect(extractScore("no json here")).toBeNull();
    expect(extractScore('{"score": "banana"}')).toBeNull();
  });
  it("extractVerdict parses score + why, sanitizes the note", () => {
    const v = extractVerdict('{"score": 0.6, "why": "Record revenue and raised guidance."}');
    expect(v).toEqual({ score: 0.6, why: "Record revenue and raised guidance." });
    expect(extractVerdict('{"score": -0.5}')?.why).toBeNull();           // why optional
    expect(extractVerdict('{"score": 0.1, "why": "line1\nline2"}')?.why).toBe("Line1 line2"); // single line
    expect(extractVerdict('{"score": 0.1, "why": 42}')?.why).toBeNull(); // wrong type dropped
    expect(extractVerdict("garbage")).toBeNull();                        // still honest-null
  });
  it("sanitizeWhy strips template openers and re-capitalizes", () => {
    expect(sanitizeWhy("The text presents new regulatory hurdles for chips.")).toBe("New regulatory hurdles for chips.");
    expect(sanitizeWhy("The filing is a standard Form 8-K header containing only metadata.")).toBe("A standard Form 8-K header containing only metadata.");
    expect(sanitizeWhy("NVIDIA reported record revenue of $68.1B.")).toBe("NVIDIA reported record revenue of $68.1B."); // real content untouched
  });
  it("isThinContent gates cover pages and TOC dumps before the LLM", () => {
    expect(isThinContent("FORM 8-K\nItem 1.01 ..... 2\nItem 9.01 ..... 3")).toBe(true); // tiny
    const tocDump = Array.from({ length: 40 }, (_, i) => `Item ${i}. Section ..... ${i}`).join("\n") + "\n" + "x".repeat(1500);
    expect(isThinContent(tocDump)).toBe(true); // TOC-dominated
    const prose = Array.from({ length: 30 }, () => "Revenue grew 40% year over year with strong margins.").join("\n");
    expect(isThinContent(prose)).toBe(false); // real multi-line prose passes
  });
  it("material 8-K items pass even when short; plain covers still gated", () => {
    expect(isThinContent("Item 5.02 Departure of Officers. The CFO resigned effective immediately.")).toBe(false); // 80 chars but material
    expect(isThinContent("Item 5.02 Departure of Officers. The CFO resigned effective 2026")).toBe(false);
    expect(isThinContent("Item 2.02 Results of Operations. See the press release.")).toBe(false);
    expect(isThinContent("FORM 8-K cover page, registrant address, date of report.".repeat(5))).toBe(true); // ~300 chars, no item
    expect(isThinContent("Item 9.01 Financial Statements and Exhibits. Exhibit index follows.".repeat(2))).toBe(true); // 9.01 is NOT material
  });
  it("does not mistake financial rows ending in numbers for a TOC", () => {
    const rows = Array.from({ length: 30 }, (_, i) => `Revenue for quarter ${i} ended June 30, 2024 increased to 1,234`).join("\n");
    expect(isThinContent(rows)).toBe(false);
  });
  it("drops explicit vacuum rationales without erasing investment substance", () => {
    expect(isBoilerplateRationale("No substantive content")).toBe(true);
    expect(isBoilerplateRationale("Routine sworn statements under oath.")).toBe(true);
    expect(isBoilerplateRationale("Not merely procedural: revenue fell 18% and guidance was cut.")).toBe(false);
    expect(isBoilerplateRationale("Procedural cover page announces the CFO resigned.")).toBe(false);
  });
  it("tonePrompt asks for the why and caps the input length", () => {
    expect(tonePrompt("q")).toContain('"why"');
    expect(tonePrompt("x".repeat(200_000)).length).toBeLessThan(108_000); // 80% of num_ctx 32768 ≈ 104k chars
    expect(tonePrompt("x".repeat(10_000)).length).toBeGreaterThan(10_000); // mid-size texts pass through whole
    expect(tonePrompt("test")).toContain('"score"');
  });
});

describe("worker companyfacts normalization", () => {
  it("flattens concepts and preserves period/form/accession provenance", () => {
    const rows = factsToRows({
      cik: 320193,
      facts: { "us-gaap": { Assets: { units: { USD: [
        { start: "2024-01-01", end: "2024-03-31", val: 123, fy: 2024, fp: "Q1", form: "10-Q", filed: "2024-04-30", accn: "0000320193-24-000001" },
      ] } } } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cik: 320193, taxonomy: "us-gaap", concept: "Assets", unit: "USD", val: 123, form: "10-Q", filed: "2024-04-30", accn: "0000320193-24-000001" });
  });

  it("normalizes SEC's zero-padded string CIK and rejects a missing CIK", () => {
    const payload = { cik: "0002115436", facts: { "us-gaap": { Assets: { units: { USD: [{ val: 1 }] } } } } };
    expect(factsToRows(payload)[0].cik).toBe(2115436);
    expect(factsToRows({ facts: payload.facts })).toEqual([]);
  });
});

describe("gdelt-csv: plan B importer parsers", () => {
  const artlist = [
    "url,url_mobile,title,seendate,socialimage,domain,language,sourcecountry",
    "https://a.com/1,,Microsoft beats,20261015083000,,a.com,English,US",
    "https://a.com/2,,More MSFT,20261015170000,,b.com,English,US",
    "https://a.com/3,,Next day,2026-10-16T09:00:00Z,,c.com,English,US",
  ].join("\n");
  it("detects ArtList and aggregates per-day buzz", () => {
    const rows = splitCsv(artlist);
    expect(detectKind(rows)).toBe("artlist");
    const sig = artlistToBuzz(789019, rows);
    expect(sig).toHaveLength(2);
    expect(sig[0]).toMatchObject({ payloadKey: "gdeltcsv:buzz:789019:20261015", magnitude: 2, eventTs: "2026-10-15 00:00:00", src: "backfill" });
    expect(sig[1].magnitude).toBe(1);
  });
  const timeline = [
    "datetime,value",
    "20261015000000,-3.5",
    "20261015120000,-4.5",
    "20261016000000,8",
  ].join("\n");
  it("detects Timeline and averages tone per day (÷10, clamped)", () => {
    const rows = splitCsv(timeline);
    expect(detectKind(rows)).toBe("timeline");
    const sig = timelineToTone(789019, rows);
    expect(sig).toHaveLength(2);
    expect(sig[0]).toMatchObject({ payloadKey: "gdeltcsv:tone:789019:20261015", score: -0.4, magnitude: 2 });
    expect(sig[1].score).toBe(0.8);
  });
  it("handles quoted fields and rejects junk", () => {
    expect(splitCsv('a,"b,c",d\n1,2,3')[0]).toEqual(["a", "b,c", "d"]);
    expect(detectKind(splitCsv("foo,bar\n1,2"))).toBe("unknown");
    expect(artlistToBuzz(1, splitCsv("seendate\nnotadate"))).toEqual([]);
  });
});

describe("gdelt: toneFromBins", () => {
  it("computes weighted average normalized to [-1,1]", () => {
    const { score, articles } = toneFromBins([
      { bin: -5, count: 2 },
      { bin: 5, count: 2 },
    ]);
    expect(score).toBe(0);
    expect(articles).toBe(4);
  });
  it("is skewed by volume, not by bin count", () => {
    const { score } = toneFromBins([
      { bin: -8, count: 90 },
      { bin: 10, count: 10 },
    ]);
    expect(score).toBeCloseTo(-0.62, 2);
  });
  it("clamps extreme tones into the contract range", () => {
    expect(toneFromBins([{ bin: 100, count: 5 }]).score).toBe(1);
    expect(toneFromBins([{ bin: -100, count: 5 }]).score).toBe(-1);
  });
  it("returns null score on empty/garbage input", () => {
    expect(toneFromBins([]).score).toBeNull();
    expect(toneFromBins([{ bin: "x", count: "y" }]).score).toBeNull();
    expect(toneFromBins([{ bin: 3, count: 0 }]).score).toBeNull();
  });
  it("accepts string-typed bins (JSON defensive)", () => {
    expect(toneFromBins([{ bin: "-4", count: "2" }]).score).toBeCloseTo(-0.4, 3);
  });
});

describe("gdelt: hourBucket + rows", () => {
  it("formats UTC hour bucket and key", () => {
    const b = hourBucket(new Date("2026-10-22T17:43:11Z"));
    expect(b.eventTs).toBe("2026-10-22 17:00:00");
    expect(b.key).toBe("2026102217");
  });
  it("buildGdeltRows emits buzz always, tone only when scored", () => {
    const b = hourBucket(new Date("2026-10-22T17:43:11Z"));
    const rows = buildGdeltRows(320193, b, [{ bin: 2, count: 10 }], { articles: [{}, {}, {}] });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ cik: 320193, source: "gdelt", signalType: "buzz", magnitude: 10, payloadKey: "gdelt:buzz:320193:2026102217" });
    expect(rows[1]).toMatchObject({ signalType: "tone", score: 0.2 });
    // no tone data → only buzz
    const rows2 = buildGdeltRows(320193, b, [], { articles: [{}] });
    expect(rows2).toHaveLength(1);
    expect(rows2[0].magnitude).toBe(1);
  });
  it("dayBucket formats UTC day for backfill", () => {
    const b = dayBucket(new Date("2026-03-05T17:43:11Z"));
    expect(b.eventTs).toBe("2026-03-05 00:00:00");
    expect(b.key).toBe("20260305");
  });
  it("backfill rows carry src=backfill and work without artlist", () => {
    const rows = buildGdeltRows(789019, dayBucket(new Date("2026-03-05T00:00:00Z")), [{ bin: -4, count: 7 }], null, "backfill");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ src: "backfill", magnitude: 7, payloadKey: "gdelt:buzz:789019:20260305" });
    expect(rows[1]).toMatchObject({ src: "backfill", score: -0.4 });
  });
  it("countArticles is defensive about shape", () => {
    expect(countArticles({})).toBe(0);
    expect(countArticles(null)).toBe(0);
    expect(countArticles({ articles: [1, 2] })).toBe(2);
  });
});

describe("stocktwits: aggregateStream + rows", () => {
  const msgs = [
    { id: 100, created_at: "2026-10-22T10:00:00Z", entities: { sentiment: { basic: "Bullish" } } },
    { id: 105, created_at: "2026-10-22T11:00:00Z", entities: { sentiment: { basic: "Bearish" } } },
    { id: 103, created_at: "2026-10-22T10:30:00Z", entities: { sentiment: null } },
    { id: 102, created_at: "2026-10-22T10:20:00Z", entities: {} },
  ];
  it("aggregates counts, score and NEWEST message by id", () => {
    const agg = aggregateStream(msgs);
    expect(agg.total).toBe(4);
    expect(agg.bullish).toBe(1);
    expect(agg.bearish).toBe(1);
    expect(agg.score).toBe(0);
    expect(agg.newestId).toBe("105");
    expect(agg.newestTs).toBe("2026-10-22 11:00:00");
  });
  it("score is null when nothing labeled", () => {
    expect(aggregateStream([{ id: 1, created_at: "2026-10-22T00:00:00Z", entities: null }]).score).toBeNull();
  });
  it("extreme one-sided streams hit ±1", () => {
    const all = [1, 2, 3].map((i) => ({ id: i, created_at: "2026-10-22T00:00:00Z", entities: { sentiment: { basic: "Bullish" } } }));
    expect(aggregateStream(all).score).toBe(1);
  });
  it("rows are idempotent: same stream → same payloadKeys", () => {
    const a1 = buildStocktwitsRows(320193, aggregateStream(msgs));
    const a2 = buildStocktwitsRows(320193, aggregateStream([...msgs].reverse()));
    expect(a1.map((r) => r.payloadKey)).toEqual(a2.map((r) => r.payloadKey));
    expect(a1[0].payloadKey).toBe("st:buzz:320193:105:4");
  });
  it("empty stream yields no rows", () => {
    expect(buildStocktwitsRows(1, aggregateStream([]))).toEqual([]);
  });
  it("crowdPrompt dumps numbered messages with a cap; buildCrowdRow carries llm provenance", () => {
    const stream = [
      { id: 100, created_at: "2026-10-22T10:00:00Z", body: "Blackwell demand insane, adding more $NVDA", entities: { sentiment: { basic: "Bullish" } } },
      { id: 101, created_at: "2026-10-22T11:00:00Z", body: "valuation scares me ngl", entities: null },
    ];
    const p = crowdPrompt("NVDA", stream);
    expect(p).toContain("1. Blackwell demand insane");
    expect(p).toContain("2. valuation scares me");
    expect(p).toContain('"score"');
    expect(crowdPrompt("NVDA", Array.from({ length: 50 }, (_, i) => ({ id: i, created_at: "x", body: "y".repeat(400) }))).length).toBeLessThan(14000);
    const agg = aggregateStream(stream);
    const row = buildCrowdRow(1045810, agg, "qwen3.5:9b", 0.6, "Blackwell hype dominates; some valuation worry.");
    expect(row?.payloadKey).toBe("llm:qwen3.5:9b:stocktwits:1045810:101");
    expect(row?.source).toBe("stocktwits");
    expect(row?.signalType).toBe("tone");
    expect(row?.note).toContain("Blackwell hype");
    expect(buildCrowdRow(1, aggregateStream([]), "m", 0, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5b — EDGAR lib: plaintext port, section extraction, windowing
// ---------------------------------------------------------------------------
import { derivePlaintext, extractScorableText, mdaWindows, loadEdgarUniverse } from "./edgar";

describe("edgar derivePlaintext", () => {
  it("strips tags, decodes entities, collapses whitespace", () => {
    const html = "<html><head><title>x</title></head><body><p>Revenue&nbsp;grew 5&#37; &amp; profit</p><script>bad()</script><div>Outlook</div></body></html>";
    const out = derivePlaintext(html);
    expect(out).toContain("Revenue grew 5% & profit");
    expect(out).toContain("Outlook");
    expect(out).not.toContain("bad()");
    expect(out).not.toContain("<p>");
  });
});

const TEN_K = [
  "TABLE OF CONTENTS",
  "Item 7. Management's Discussion and Analysis ......... 42",
  "Item 8. Financial Statements ......... 60",
  "PART II",
  "Item 7. Management's Discussion and Analysis of Financial Condition",
  "Revenue increased driven by services.",
  "Margins expanded.",
  "Item 7A. Quantitative and Qualitative Disclosures About Market Risk",
  "We are exposed to rates.",
  "SIGNATURES",
  "Pursuant to the requirements...",
].join("\n");

describe("edgar extractScorableText", () => {
  it("10-Q regression: NVDA real TOC shape — bare label line, title+page on the NEXT line", () => {
    // proven against nvda-20260726.htm (10-Q, accn 0001045810-26-000075):
    // TOC lines are "Item 2." ALONE with the title and page number on the
    // following line; without next-line detection the Part-II TOC occurrence
    // ("Unregistered Sales… 39") won as 'last non-TOC' and MD&A was lost.
    const q = [
      "PART I. Financial Information",
      "Item 2.",
      "Management's Discussion and Analysis of Financial Condition and Results of Operations 25",
      "Item 3.",
      "Quantitative and Qualitative Disclosures About Market Risk 33",
      "Part II. Other Information",
      "Item 2.",
      "Unregistered Sales of Equity Securities and Use of Proceeds 39",
      "Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations",
      "Revenue of $46.7 billion, up 56% year over year.",
      "Data Center demand exceeded supply.",
      "Item 3. Quantitative and Qualitative Disclosures About Market Risk",
      "We are exposed to interest rate risk.",
    ].join("\n");
    const out = extractScorableText(q, "10-Q");
    expect(out).toContain("Revenue of $46.7 billion");
    expect(out).not.toContain("Unregistered Sales");
    expect(out).not.toContain("interest rate risk");
  });
  it("10-K regression: real NVDA shape — TOC page numbers as standalone nbsp lines + TOC 'Signatures' entry", () => {
    // proven against the 2026-02-25 10-K: TOC entry = bare "Item 7." / title /
    // "  36" page line; and the TOC's own "Signatures" line must NOT truncate.
    const k = [
      "Item 7.",
      "Management's Discussion and Analysis of Financial Condition and Results of Operations",
      "  36",
      "Item 8.",
      "Financial Statements and Supplementary Data",
      "  45",
      "Signatures",
      "  47",
      "PART II",
      "Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations",
      "The following discussion and analysis covers fiscal 2026 results.",
      "Item 7A. Quantitative and Qualitative Disclosures About Market Risk",
      "Rate exposure.",
      "SIGNATURES",
      "signed",
    ].join("\n");
    const out = extractScorableText(k, "10-K");
    expect(out).toContain("fiscal 2026 results");
    expect(out).not.toContain("Supplementary Data");
    expect(out).not.toContain("Rate exposure");
    expect(out).not.toContain("signed");
  });
  it("10-K: skips the TOC occurrence, takes the body Item 7, ends at Item 7A, drops SIGNATURES", () => {
    const out = extractScorableText(TEN_K, "10-K");
    expect(out).toContain("Revenue increased driven by services.");
    expect(out).not.toContain("TABLE OF CONTENTS");
    expect(out).not.toContain("exposed to rates");
    expect(out).not.toContain("Pursuant");
  });
  it("10-Q: Item 2 .. Item 3", () => {
    const q = ["Item 2. Management's Discussion and Analysis", "Solid quarter.", "Item 3. Quantitative disclosures", "Risk table."].join("\n");
    const out = extractScorableText(q, "10-Q");
    expect(out).toContain("Solid quarter.");
    expect(out).not.toContain("Risk table.");
  });
  it("8-K: whole body without SIGNATURES", () => {
    const k = ["Item 2.02 Results of Operations", "EPS beat.", "SIGNATURES", "signed"].join("\n");
    const out = extractScorableText(k, "8-K");
    expect(out).toContain("EPS beat.");
    expect(out).not.toContain("signed");
  });
  it("8-K: cover page + TOC are skipped, scoring starts at the first Item heading", () => {
    const k = [
      "UNITED STATES SECURITIES AND EXCHANGE COMMISSION",
      "FORM 8-K CURRENT REPORT",
      "TABLE OF CONTENTS",
      "Item 2.02 Results of Operations ..... 2",
      "Item 2.02 Results of Operations",
      "Revenue grew 40% year over year.",
      "SIGNATURES",
    ].join("\n");
    const out = extractScorableText(k, "8-K");
    expect(out).toContain("Revenue grew 40%");
    expect(out).not.toContain("SECURITIES AND EXCHANGE");
    expect(out).not.toContain("TABLE OF CONTENTS");
    expect(out).not.toContain(".....");
  });
  it("anchor miss on 10-K falls back to the head of the document", () => {
    const out = extractScorableText("No items here at all, just prose.", "10-K");
    expect(out).toContain("just prose.");
  });
  it("amendments reuse the base form's anchors (10-K/A → Item 7 MD&A; 8-K/A → body)", () => {
    const out = extractScorableText(TEN_K, "10-K/A");
    expect(out).toContain("Revenue increased driven by services.");
    const k = ["Item 2.02 Results of Operations (amended)", "Restated EPS lower.", "SIGNATURES", "signed"].join("\n");
    expect(extractScorableText(k, "8-K/A")).toContain("Restated EPS lower.");
  });
  it("13D/G schedules: cover skipped, starts at the first Item (Item 4 Purpose is the meat)", () => {
    const d = [
      "SCHEDULE 13D",
      "CUSIP 037833100",
      "Item 1. Security and Issuer",
      "Class A common stock of Apple Inc.",
      "Item 4. Purpose of Transaction",
      "The reporting person intends to engage with management on capital allocation.",
      "Item 7. Material to be Filed as Exhibits",
    ].join("\n");
    const out = extractScorableText(d, "SC 13D");
    expect(out).toContain("intends to engage with management");
    expect(out).not.toContain("CUSIP 037833100");
    expect(extractScorableText(d, "SCHEDULE 13G/A")).toContain("intends to engage with management");
  });
});

describe("edgar mdaWindows", () => {
  it("short text → single window", () => {
    expect(mdaWindows("hello")).toEqual(["hello"]);
  });
  it("long text → evenly spaced windows covering start and end", () => {
    const text = "x".repeat(10_000);
    const w = mdaWindows(text, 3000, 3);
    expect(w).toHaveLength(3);
    expect(w[0]).toBe(text.slice(0, 3000));
    expect(w[2]).toBe(text.slice(7000));
  });
});

describe("edgar universe", () => {
  it("carries the full S&P 500 with the 6 core companies leading", () => {
    const u = loadEdgarUniverse();
    expect(u.length).toBeGreaterThan(490);
    expect(u.slice(0, 6).map((c) => c.ticker)).toEqual(["AAPL", "NVDA", "PLD", "META", "IBM", "LMT"]);
    expect(u.find((c) => c.ticker === "IBM")?.cik).toBe(51143);
    expect(u.find((c) => c.ticker === "META")?.cik).toBe(1326801);
    expect(u.find((c) => c.ticker === "LMT")?.cik).toBe(936468);
  });
  it("loads the dynamic 20-company universe without AAPL", () => {
    const u = loadEdgarUniverse("edgar-universe-20.json");
    expect(u).toHaveLength(20);
    expect(u.some((c) => c.ticker === "AAPL")).toBe(false);
    expect(u.find((c) => c.ticker === "PLTR")?.cik).toBe(1321655);
    expect(u.find((c) => c.ticker === "RCL")?.cik).toBe(884887);
    expect(u.find((c) => c.ticker === "NEE")?.cik).toBe(753308);
  });
  it("loads the expanded 35-company universe with unique tickers and KMI", () => {
    const u = loadEdgarUniverse("edgar-universe-35.json");
    expect(u).toHaveLength(35);
    expect(new Set(u.map((c) => c.ticker)).size).toBe(35);
    expect(u.some((c) => c.ticker === "AAPL")).toBe(false);
    expect(u.find((c) => c.ticker === "KMI")?.cik).toBe(1506307);
    expect(u.find((c) => c.ticker === "FSLR")?.cik).toBe(1274494);
    expect(u.find((c) => c.ticker === "SMCI")?.cik).toBe(1375365);
  });
  it("separates 50 current S&P tickers from predecessor and off-index legacy", () => {
    const current = loadEdgarUniverse("research-universe-50.json");
    const all = loadEdgarUniverse("research-universe-53.json");
    expect(current).toHaveLength(50);
    expect(all).toHaveLength(53);
    expect(new Set(all.map((c) => c.cik)).size).toBe(53);
    expect(current.map((c) => c.ticker)).toEqual(expect.arrayContaining(["AIG", "COP", "LIN"]));
    expect(current.some((c) => ["RIVN", "ENLT", "XOM_PRE"].includes(c.ticker))).toBe(false);
    expect(all.find((c) => c.ticker === "XOM_PRE")?.cik).toBe(34088);
    expect(all.find((c) => c.ticker === "RIVN")?.cik).toBe(1874178);
    expect(all.find((c) => c.ticker === "ENLT")?.cik).toBe(1922641);
  });
});

// ---------------------------------------------------------------------------
// 5e — digest prompt builder
// ---------------------------------------------------------------------------
describe("digest: buildDigestPrompt", () => {
  const rows = [
    { ticker: "NVDA", source: "edgar", signalType: "tone", eventTs: "2026-10-22 16:00:00", score: 0.95, magnitude: 1, note: "Record Q2 revenue of $96.2B driven by Blackwell." },
    { ticker: "NVDA", source: "stocktwits", signalType: "tone", eventTs: "2026-10-22 18:00:00", score: 0.7, magnitude: 30, note: "Crowd hyped on data center demand, some valuation worry." },
    { ticker: "PLD", source: "stocktwits", signalType: "label", eventTs: "2026-10-22 15:00:00", score: 1, magnitude: 5, note: null },
  ];
  it("groups by ticker, keeps SEC facts and crowd chatter as separate items", () => {
    const p = buildDigestPrompt("2026-10-23", rows);
    expect(p).toContain("NVDA:");
    expect(p).toContain("[edgar/tone] mood +0.95");
    expect(p).toContain("Record Q2 revenue of $96.2B");
    expect(p).toContain("[stocktwits/label] mood +1.00");
    expect(p).toContain("never blend them");
    expect(p).toContain("2026-10-23");
  });
  it("marks scoreless rows n/a and caps input", () => {
    const p = buildDigestPrompt("2026-10-23", [{ ticker: "T", source: "stocktwits", signalType: "buzz", eventTs: "x", score: null, magnitude: 30, note: null }]);
    expect(p).toContain("mood n/a, 30 msgs");
    const big = buildDigestPrompt("2026-10-23", Array.from({ length: 300 }, () => ({ ...rows[0], note: "x".repeat(300) })));
    expect(big.length).toBeLessThan(65000);
  });
});

// ---------------------------------------------------------------------------
// 5f — 13F: info table parser, quarter dedupe, position events
// ---------------------------------------------------------------------------
import { parseInfoTable, latestPerQuarter, positionEvent, eventNote, buildPositionRow, loadFundUniverse, shouldRequestCusip, mergeQuarterFilings, amendmentKindFromPrimary } from "./thirteenf";

describe("13f: parseInfoTable", () => {
  const xml = `<?xml version="1.0"?><n1:informationTable xmlns:n1="http://www.sec.gov/edgar/document/thirteenf/informationtable">
    <n1:infoTable><n1:nameOfIssuer>APPLE INC</n1:nameOfIssuer><n1:titleOfClass>COM</n1:titleOfClass>
      <n1:cusip>037833100</n1:cusip><n1:value>174000</n1:value>
      <n1:shrsOrPrnAmt><n1:sshPrnamt>1000</n1:sshPrnamt><n1:sshPrnamtType>SH</n1:sshPrnamtType></n1:shrsOrPrnAmt>
    </n1:infoTable>
    <n1:infoTable><n1:nameOfIssuer>NVIDIA CORP</n1:nameOfIssuer><n1:cusip>67066G104</n1:cusip>
      <n1:value>2500</n1:value><n1:shrsOrPrnAmt><n1:sshPrnamt>500</n1:sshPrnamt></n1:shrsOrPrnAmt>
    </n1:infoTable></n1:informationTable>`;
  it("parses namespace-agnostic infoTable blocks, value thousands → usd", () => {
    const rows = parseInfoTable(xml);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ issuer: "APPLE INC", cusip: "037833100", secClass: "COM", valueUsd: 174_000_000, shares: 1000 });
    expect(rows[1].cusip).toBe("67066G104");
    expect(rows[1].valueUsd).toBe(2_500_000);
  });
  it("captures option classes (PUT/CALL) and scores them at half weight with sign", () => {
    const optXml = `<informationTable><infoTable><nameOfIssuer>NVIDIA CORP</nameOfIssuer>
      <titleOfClass>PUT</titleOfClass><cusip>67066G104</cusip><value>800000</value>
      <shrsOrPrnAmt><sshPrnamt>2000000</sshPrnamt></shrsOrPrnAmt></infoTable></informationTable>`;
    const rows = parseInfoTable(optXml);
    expect(rows[0].secClass).toBe("PUT");
    const ev = positionEvent(null, 2_000_000, 8e8)!;
    expect(eventNote("Citadel Advisors", ev, "PUT")).toContain("new PUT position");
    const row = buildPositionRow(1423053, 1045810, { accessionNo: "a1", form: "13F-HR", filingDate: "2026-02-14", reportDate: "2025-12-31" }, ev, "n", "PUT");
    expect(row.score).toBe(-0.5); // bearish direction, half weight (hedge ambiguity)
    expect(row.payloadKey).toBe("13f:pos:1423053:1045810:PUT:a1");
    const callRow = buildPositionRow(1423053, 1045810, { accessionNo: "a1", form: "13F-HR", filingDate: "2026-02-14", reportDate: "2025-12-31" }, ev, "n", "CALL");
    expect(callRow.score).toBe(0.5);
  });
});

describe("13f: latestPerQuarter + events", () => {
  it("amendment supersedes the original for the same quarter", () => {
    const fs = [
      { accessionNo: "a1", form: "13F-HR", filingDate: "2026-02-10", reportDate: "2025-12-31" },
      { accessionNo: "a2", form: "13F-HR/A", filingDate: "2026-03-01", reportDate: "2025-12-31" },
      { accessionNo: "a3", form: "13F-HR", filingDate: "2026-05-10", reportDate: "2026-03-31" },
    ];
    const out = latestPerQuarter(fs);
    expect(out.map((f) => f.accessionNo)).toEqual(["a2", "a3"]);
  });
  it("events fire only on new/exit/±30%", () => {
    expect(positionEvent(null, 1000, 5e6)).toEqual({ kind: "new", shares: 1000, valueUsd: 5e6 });
    expect(positionEvent(1000, 0, null)).toEqual({ kind: "exit", shares: 1000, valueUsd: null });
    expect(positionEvent(1000, 1400, null)?.kind).toBe("change");
    expect(positionEvent(1000, 1200, null)).toBeNull(); // +20% — noise
    const ev = positionEvent(1000, 1400, 1.4e9);
    expect(eventNote("Citadel Advisors", ev!)).toBe("Citadel Advisors: +40% to 1,400 sh ($1.4B)");
    expect(buildPositionRow(1423053, 320193, { accessionNo: "acc1", form: "13F-HR", filingDate: "2026-02-14", reportDate: "2025-12-31" }, ev!, "n").payloadKey)
      .toBe("13f:pos:1423053:320193:COM:acc1");
  });
  it("fund universe carries verified CIKs", () => {
    const f = loadFundUniverse();
    expect(f.length).toBeGreaterThanOrEqual(28);
    expect(f.find((x) => x.name === "Berkshire Hathaway")?.cik).toBe(1067983);
    expect(f.find((x) => x.name === "Citadel Advisors")?.cik).toBe(1423053);
  });
});

describe("13f negative-cache repair policy", () => {
  it("requests unknown CUSIPs and retries negative cache only in repair mode", () => {
    expect(shouldRequestCusip(undefined, false, false)).toBe(true);
    const negative = { cik: null, ticker: null };
    expect(shouldRequestCusip(negative, false, false)).toBe(false);
    expect(shouldRequestCusip(negative, true, false)).toBe(true);
    expect(shouldRequestCusip(negative, true, true)).toBe(false);
  });
  it("does not resend ticker-only or resolved cache rows to FIGI", () => {
    expect(shouldRequestCusip({ cik: null, ticker: "AAPL" }, true, false)).toBe(false);
    expect(shouldRequestCusip({ cik: 320193, ticker: "AAPL" }, true, false)).toBe(false);
  });
});

describe("13f semantic amendment merge", () => {
  const h = (cusip: string, valueUsd: number) => ({ issuer: cusip, cusip, secClass: "COM", valueUsd, shares: 1 });
  it("replaces on RESTATEMENT and adds NEW HOLDINGS without dropping the book", () => {
    const out = mergeQuarterFilings([
      { accessionNo: "003", filingDate: "2026-05-15", form: "13F-HR/A", amendment: "NEW HOLDINGS", holdings: [h("D", 400), h("A", 120)] },
      { accessionNo: "001", filingDate: "2026-05-08", form: "13F-HR", amendment: "ORIGINAL", holdings: [h("A", 100), h("B", 200)] },
      { accessionNo: "002", filingDate: "2026-05-15", form: "13F-HR/A", amendment: "RESTATEMENT", holdings: [h("A", 110), h("C", 300)] },
    ]);
    expect(out.holdings.map((x) => [x.cusip, x.valueUsd])).toEqual([["A", 120], ["C", 300], ["D", 400]]);
    expect(out.holdings.find((x) => x.cusip === "A")?.sourceAccessionNo).toBe("003");
    expect(out.latestAccessionNo).toBe("003");
  });
  it("adds a partial amendment to the original and fails closed on unknown types", () => {
    const original = { accessionNo: "orig", filingDate: "2026-05-08", form: "13F-HR", amendment: "ORIGINAL" as const, holdings: [h("A", 100)] };
    const addition = { accessionNo: "add", filingDate: "2026-05-15", form: "13F-HR/A", amendment: "NEW HOLDINGS" as const, holdings: [h("B", 200)] };
    expect(mergeQuarterFilings([original, addition]).holdings).toHaveLength(2);
    expect(() => mergeQuarterFilings([{ ...addition, amendment: "UNKNOWN" }])).toThrow("Unknown 13F amendment type");
  });
  it("reads amendment semantics from primary_doc.xml", () => {
    expect(amendmentKindFromPrimary("<amendmentType>RESTATEMENT</amendmentType>", "13F-HR/A")).toBe("RESTATEMENT");
    expect(amendmentKindFromPrimary("<amendmentType>NEW HOLDINGS</amendmentType>", "13F-HR/A")).toBe("NEW HOLDINGS");
    expect(amendmentKindFromPrimary("<amendmentType>OTHER</amendmentType>", "13F-HR/A")).toBe("UNKNOWN");
    expect(amendmentKindFromPrimary("", "13F-HR")).toBe("ORIGINAL");
  });
});

// ---------------------------------------------------------------------------
// 13f scale auto-calibration
// ---------------------------------------------------------------------------
import { autoScale13F } from "./thirteenf";

describe("13f autoScale13F", () => {
  it("dollar-reported filing (median implied > $5,000) is divided by 1000", () => {
    // Point72-style: SPY value already in dollars → implied ~$747 × 1000
    const hs = Array.from({ length: 10 }, (_, i) => ({
      issuer: "X", cusip: "c" + i, secClass: "COM",
      valueUsd: 746_770 * (100 + i), shares: 100 + i,
    }));
    const r = autoScale13F(hs);
    expect(r.scale).toBe(0.001);
    expect(hs[0].valueUsd).toBe(Math.round(746_770 * 100 / 1000));
  });
  it("spec-compliant filing (thousands) is untouched", () => {
    const hs = Array.from({ length: 10 }, (_, i) => ({
      issuer: "X", cusip: "c" + i, secClass: "COM",
      valueUsd: 250 * (100 + i), shares: 100 + i, // implied $250
    }));
    expect(autoScale13F(hs).scale).toBe(1);
  });
  it("tiny books (<5 priced rows) are never rescaled", () => {
    const hs = [{ issuer: "X", cusip: "c", secClass: "COM", valueUsd: 10_000_000, shares: 1 }];
    expect(autoScale13F(hs).scale).toBe(1);
  });
});


describe("edgar: fair-access failures", () => {
  it("classifies only 404/410 as permanently missing", () => {
    expect(isPermanentSecMissing(new SecHttpError(404, "https://sec.test"))).toBe(true);
    expect(isPermanentSecMissing(new SecHttpError(410, "https://sec.test"))).toBe(true);
    expect(isPermanentSecMissing(new SecHttpError(403, "https://sec.test"))).toBe(false);
    expect(isPermanentSecMissing(new SecHttpError(500, "https://sec.test"))).toBe(false);
  });

  it("secGet does not retry a permanent 404", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("missing", { status: 404 }); };
    try {
      await expect(secGet("https://sec.test/missing")).rejects.toMatchObject({ status: 404 });
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});


describe("edgar tone: manifest rerun filter", () => {
  const base = { fetched: true, scored: false, filingDate: "2024-01-01" };
  it("does not reprocess thin or boilerplate skips unless explicitly requested", () => {
    expect(shouldScoreManifestEntry({ ...base, error: "thin content (cover/TOC/XBRL header)" }, null, false)).toBe(false);
    expect(shouldScoreManifestEntry({ ...base, error: "boilerplate-only content" }, null, false)).toBe(false);
    expect(shouldScoreManifestEntry({ ...base, error: "thin content (cover/TOC/XBRL header)" }, null, true)).toBe(true);
  });
  it("keeps parse failures retryable only within the per-model cap and honors scored/fetched/from", () => {
    expect(shouldScoreManifestEntry({ ...base, error: "no parseable score" }, null, false)).toBe(true);
    expect(shouldScoreManifestEntry({ ...base, error: "no parseable score", llmErrorCount: 1, llmErrorModel: "qwen" }, null, false, "qwen")).toBe(true);
    expect(shouldScoreManifestEntry({ ...base, error: "no parseable score", llmErrorCount: 2, llmErrorModel: "qwen" }, null, false, "qwen")).toBe(false);
    expect(shouldScoreManifestEntry({ ...base, error: "no parseable score", llmErrorCount: 2, llmErrorModel: "qwen" }, null, true, "qwen")).toBe(true);
    expect(shouldScoreManifestEntry({ ...base, error: "no parseable score", llmErrorCount: 2, llmErrorModel: "qwen" }, null, false, "other-model")).toBe(true);
    expect(shouldScoreManifestEntry({ ...base, error: "no parseable score" }, "2025-01-01", false)).toBe(false);
    expect(shouldScoreManifestEntry({ ...base, scored: true }, null, false)).toBe(false);
    expect(shouldScoreManifestEntry({ ...base, fetched: false }, null, false)).toBe(false);
    expect(shouldScoreManifestEntry({ ...base, error: "LLM request failed" }, null, false)).toBe(true);
    expect(shouldScoreManifestEntry({ ...base, error: "cache file unreadable" }, null, false)).toBe(true);
  });
});


describe("edgar fetch: EX-99 idempotency", () => {
  it("does not redownload an exhibit that already exists on disk", () => {
    expect(shouldDownloadExhibit({ form: "8-K", exChecked: false, exFile: "ex99.htm" }, true)).toBe(false);
    expect(shouldDownloadExhibit({ form: "8-K", exChecked: true, exFile: "ex99.htm" }, false)).toBe(false);
  });
  it("fetches missing exhibits and leaves other forms alone", () => {
    expect(shouldDownloadExhibit({ form: "8-K", exChecked: false, exFile: null }, false)).toBe(true);
    expect(shouldDownloadExhibit({ form: "8-K", exChecked: false, exFile: "ex99.htm" }, false)).toBe(true);
    expect(shouldDownloadExhibit({ form: "8-K/A", exChecked: false, exFile: "ex99.htm" }, false)).toBe(true);
    expect(shouldDownloadExhibit({ form: "8-K/A", exChecked: true, exFile: "ex99.htm" }, true)).toBe(false);
    expect(shouldDownloadExhibit({ form: "10-K", exChecked: false, exFile: null }, false)).toBe(false);
  });
});


describe("ollama structured tone output", () => {
  it("requests score/why schema and a capped response", async () => {
    const original = globalThis.fetch;
    let body: any;
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ response: "{\"score\":0.2,\"why\":\"ok\"}", total_duration: 1000000000, eval_count: 1, eval_duration: 1000000000 }), { status: 200 });
    };
    try {
      await generate("test", { jsonMode: true, numPredict: 256 });
      expect(body.format.type).toBe("object");
      expect(body.format.required).toEqual(["score", "why"]);
      expect(body.options.num_predict).toBe(256);
      expect(body.options.num_ctx).toBe(32768);
      expect(body.keep_alive).toBe("30m");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("caps default tone windows without discarding document text", () => {
    const text = "x".repeat(100_000);
    const windows = mdaWindows(text);
    expect(windows.length).toBeLessThanOrEqual(8);
    expect(windows.every((w) => w.length <= 16_000)).toBe(true);
    expect(windows[0]).toBe(text.slice(0, 16_000));
    expect(windows.at(-1)).toBe(text.slice(90_000));
    expect(windows.at(-1)!.length).toBe(10_000);
  });

  it("avoids near-duplicate windows and tiny-overflow double scoring", () => {
    const tinyOverflow = "x".repeat(16_001);
    expect(mdaWindows(tinyOverflow)).toEqual([tinyOverflow]);
    const text = "x".repeat(20_000);
    const windows = mdaWindows(text);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toBe(text.slice(0, 16_000));
    expect(windows[1]).toBe(text.slice(15_000));
    expect(windows.reduce((n, w) => n + w.length, 0)).toBe(21_000);
  });

  it("keeps full-window sampling for texts beyond the coverage cap", () => {
    const text = "x".repeat(200_000);
    const windows = mdaWindows(text);
    expect(windows).toHaveLength(8);
    expect(windows.every((w) => w.length === 16_000)).toBe(true);
    expect(windows[0]).toBe(text.slice(0, 16_000));
    expect(windows.at(-1)).toBe(text.slice(184_000));
  });
});
