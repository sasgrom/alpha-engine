/**
 * Tests of the pure section parser (services/sections.ts) on synthetic
 * plaintext fixtures reproducing the typical EDGAR document structure:
 *  - a table of contents (TOC) with dot leaders and page numbers + a body
 *    with the same headings (the main sectioning trap);
 *  - a two-part 10-Q with colliding Item numbering (Part I vs Part II);
 *  - an 8-K with decimal item numbering (2.02, 9.01);
 *  - a DEF 14A without item structure (named blocks);
 *  - two-line headings ("Item 7." + the title on the next line);
 *  - last-section truncation at SIGNATURES.
 * Fixtures are written in derivePlaintext() style: lines already trimmed.
 */
import { describe, it, expect } from "vitest";
import { parseSections } from "./sections";

/** Utility: section text of a hit, sliced from the source text. */
const span = (text: string, h: { charStart: number; charEnd: number }) => text.slice(h.charStart, h.charEnd);

// --- fixture: a typical 10-K with a TOC and a body --------------------------
const TEN_K = [
  "TABLE OF CONTENTS",
  "Part I",
  "Item 1. Business ...................... 3",
  "Item 1A. Risk Factors ................. 15",
  "Part II",
  "Item 7. Management's Discussion and Analysis ...... 42",
  "Item 8. Financial Statements and Supplementary Data . 58",
  "Signatures ............................ 95",
  "PART I",
  "Item 1. Business",
  "The Company designs and manufactures widgets.",
  "Item 1A. Risk Factors",
  "Investing in our securities involves risks.",
  "PART II",
  "Item 7.",
  "Management's Discussion and Analysis of Financial Condition and Results of Operations",
  "Our revenues grew 12% driven by strong widget demand.",
  "Margins expanded on favorable mix.",
  "Item 8. Financial Statements and Supplementary Data",
  "CONSOLIDATED BALANCE SHEETS",
  "Assets ... Liabilities ...",
  "SIGNATURES",
  "Pursuant to the requirements the registrant has duly caused this report to be signed.",
].join("\n");

describe("parseSections: 10-K", () => {
  const r = parseSections(TEN_K, "10-K");
  const byKey = new Map(r.sections.map((s) => [s.sectionKey, s]));

  it("extracts canonical section keys", () => {
    expect([...byKey.keys()]).toEqual(
      expect.arrayContaining(["item1_business", "item1a_risk", "item7_mda", "item8_financials"])
    );
  });

  it("MD&A body — NOT the TOC (the main trap)", () => {
    const mda = byKey.get("item7_mda")!;
    const text = span(TEN_K, mda);
    expect(text).toContain("Our revenues grew 12%");
    expect(text).not.toContain("....");
    expect(mda.flags).not.toContain("toc_fallback");
  });

  it("a two-line heading is glued into the title", () => {
    expect(byKey.get("item7_mda")!.title).toMatch(/Item 7\. Management's Discussion/);
  });

  it("item8 is truncated at SIGNATURES", () => {
    const text = span(TEN_K, byKey.get("item8_financials")!);
    expect(text).toContain("CONSOLIDATED BALANCE SHEETS");
    expect(text).not.toContain("duly caused this report");
  });

  it("core present -> no missing flag", () => {
    expect(r.docFlags).not.toContain("missing:item7_mda");
  });
});

// --- fixture: a 10-Q with two parts and colliding numbering -----------------
const TEN_Q = [
  "Part I. Financial Information",
  "Item 1. Financial Statements",
  "CONDENSED CONSOLIDATED STATEMENTS OF INCOME",
  "Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations",
  "Revenue increased year over year.",
  "Part II. Other Information",
  "Item 1. Legal Proceedings",
  "We are party to litigation in the normal course.",
  "Item 1A. Risk Factors",
  "There have been no material changes to our risk factors.",
  "Item 6. Exhibits",
  "Exhibit 31.1 Certification",
  "SIGNATURES",
].join("\n");

describe("parseSections: 10-Q part-aware keys", () => {
  const r = parseSections(TEN_Q, "10-Q");
  const keys = r.sections.map((s) => s.sectionKey);

  it("Item 1 in Part I and Part II get DIFFERENT keys", () => {
    expect(keys).toContain("p1_item1_financials");
    expect(keys).toContain("p2_item1_legal");
  });

  it("MD&A = p1_item2_mda, Risk Factors = p2_item1a_risk", () => {
    expect(keys).toContain("p1_item2_mda");
    expect(keys).toContain("p2_item1a_risk");
  });

  it("the legal section contains exactly the Part II text", () => {
    const legal = r.sections.find((s) => s.sectionKey === "p2_item1_legal")!;
    expect(span(TEN_Q, legal)).toContain("normal course");
  });
});

// --- fixture: 8-K -------------------------------------------------------------
const EIGHT_K = [
  "Item 2.02 Results of Operations and Financial Condition",
  "On November 5, 2025, the Company issued a press release announcing results.",
  "Item 9.01 Financial Statements and Exhibits",
  "(d) Exhibits. 99.1 Press release.",
].join("\n");

describe("parseSections: 8-K", () => {
  const r = parseSections(EIGHT_K, "8-K");
  it("decimal numbers -> 8k_N_NN keys", () => {
    expect(r.sections.map((s) => s.sectionKey)).toEqual(["8k_2_02", "8k_9_01"]);
  });
  it("docFlags empty when items are found", () => {
    expect(r.docFlags).toEqual([]);
  });
});

// --- edge cases ----------------------------------------------------------------
describe("parseSections: edge cases", () => {
  it("10-K without MD&A -> docFlag missing:item7_mda", () => {
    const r = parseSections("Item 1. Business\nWe make widgets.\nSIGNATURES", "10-K");
    expect(r.docFlags).toContain("missing:item7_mda");
  });

  it("8-K without items -> no_items_found", () => {
    const r = parseSections("Cover page only.", "8-K");
    expect(r.docFlags).toContain("no_items_found");
  });

  it("DEF 14A: CD&A from the body, not the TOC", () => {
    const def14a = [
      "TABLE OF CONTENTS",
      "Compensation Discussion and Analysis ..... 12",
      "Executive Compensation ................... 20",
      "PROPOSAL 1: ELECTION OF DIRECTORS",
      "Nominees are listed below.",
      "COMPENSATION DISCUSSION AND ANALYSIS",
      "This section explains our compensation philosophy and objectives.",
      "EXECUTIVE COMPENSATION",
      "Summary Compensation Table follows.",
    ].join("\n");
    const r = parseSections(def14a, "DEF 14A");
    const cdna = r.sections.find((s) => s.sectionKey === "def14a_cdna")!;
    expect(span(def14a, cdna)).toContain("compensation philosophy");
    expect(span(def14a, cdna)).not.toContain(".....");
    expect(r.docFlags).toEqual([]);
  });

  it("a 10-K/A amendment parses by its base form", () => {
    const r = parseSections(TEN_K, "10-K/A");
    expect(r.sections.some((s) => s.sectionKey === "item7_mda")).toBe(true);
  });
});
