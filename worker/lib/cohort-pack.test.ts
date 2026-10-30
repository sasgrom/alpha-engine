import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCohortExpectationPrompt,
  buildCohortPack,
  buildCohortPackWithHashes,
  cohortInputLimit,
  cohortSourceText,
  estimateCohortTokens,
  type CohortSourceDocument,
} from "./cohort-pack";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const doc = (overrides: Partial<CohortSourceDocument> = {}): CohortSourceDocument => ({
  cik: 1,
  ticker: "AAA",
  accessionNo: "0000000-26-000001",
  sourceId: "source-a",
  form: "8-K",
  role: "exhibit",
  sourceFile: "a.htm",
  filingDate: "2026-10-29",
  eventTs: "2026-10-29 18:00:00",
  reportDate: "2026-09-30",
  plain: "Revenue is expected to be $100 billion.",
  ...overrides,
});

describe("cohort pack", () => {
  it("derives input budgets from runtime context, not the advertised model maximum", () => {
    expect(cohortInputLimit(32768)).toBe(104857);
    expect(cohortInputLimit(65536)).toBe(209715);
    expect(cohortInputLimit(262144)).toBe(838860);
    expect(estimateCohortTokens("abcd".repeat(100))).toBe(100);
  });

  it("preserves a large whole guidance section instead of imposing a 4K/16K cap", () => {
    const longSection = `Third Quarter Guidance\n${"Revenue is expected to be $100 billion with margin assumptions. ".repeat(400)}`;
    expect(longSection.length).toBeGreaterThan(16_000);
    const pack = buildCohortPack([doc({ form: "10-Q", role: "primary", plain: longSection })], { contextTokens: 32768, generatedAt: "now" });
    expect(pack.containers).toHaveLength(1);
    expect(pack.containers[0].text).toContain(longSection.trim());
    expect(pack.unpacked).toHaveLength(0);
  });

  it("starts a new container by document instead of truncating it", () => {
    const a = doc({ plain: "Revenue is expected to be $100 billion. ".repeat(40) });
    const b = doc({ sourceId: "source-b", accessionNo: "0000000-26-000002", sourceFile: "b.htm", plain: "Operating income is expected to be $20 billion. ".repeat(40) });
    const pack = buildCohortPack([a, b], { contextTokens: 1000, generatedAt: "now" });
    expect(pack.containers.length).toBeGreaterThan(1);
    expect(pack.containers.every((container) => container.text.length <= pack.maxInputChars)).toBe(true);
    expect(pack.containers.map((container) => container.sources[0].sourceId)).toEqual(["source-a", "source-b"]);
  });

  it("splits long sections only at complete subheadings or paragraphs", () => {
    const partA = "Revenue assumptions\nRevenue is expected to be $100 billion. ".repeat(20);
    const partB = "Margin assumptions\nGross margin is expected to be 70%. ".repeat(20);
    const pack = buildCohortPack([doc({ plain: `${partA}\n${partB}` })], { contextTokens: 700, generatedAt: "now" });
    expect(pack.unpacked).toHaveLength(0);
    expect(pack.containers.length).toBeGreaterThan(1);
    expect(pack.containers.every((container) => container.text.length <= pack.maxInputChars)).toBe(true);
    expect(pack.containers.map((container) => container.text).join("\n")).toContain("Margin assumptions");
  });

  it("fails closed on an indivisible oversized table rather than cutting it", () => {
    const huge = "x".repeat(5000);
    const pack = buildCohortPack([doc({ plain: huge })], { contextTokens: 1000, generatedAt: "now" });
    expect(pack.containers).toHaveLength(0);
    expect(pack.unpacked).toHaveLength(1);
    expect(pack.unpacked[0].reason).toBe("indivisible_block_exceeds_context");
    expect(pack.unpacked[0].charBytes).toBe(5000);
  });

  it("keeps amendments chronological and exposes exact target text", () => {
    const amendment = doc({ sourceId: "amendment", accessionNo: "0000000-26-000099", role: "amendment", form: "8-K/A", eventTs: "2026-11-02 09:00:00", plain: "Revenue guidance is revised to $110 billion." });
    const original = doc({ plain: "Revenue is expected to be $100 billion." });
    const pack = buildCohortPackWithHashes([amendment, original], { contextTokens: 32768, generatedAt: "now" }, sha256);
    const container = pack.containers[0];
    expect(container.sources.map((source) => source.role)).toEqual(["exhibit", "amendment"]);
    expect(cohortSourceText(container, "amendment")).toBe("Revenue guidance is revised to $110 billion.");
    expect(container.inputSha256).toHaveLength(64);
    const prompt = buildCohortExpectationPrompt(container, "amendment", { ticker: "AAA", form: "8-K/A", filingDate: "2026-11-02", accessionNo: amendment.accessionNo });
    expect(prompt).toContain("Extract ONLY from SOURCE_ID amendment");
    expect(prompt).toContain("guidanceStatus must describe only this source document");
  });

  it("aligns an earnings 8-K with the 10-Q period from its content, not its filing date", () => {
    const release = doc({ plain: "Amazon announces results for its third quarter ended September 30, 2026. Net sales increased." });
    const quarterly = doc({ sourceId: "quarterly", accessionNo: "0000000-26-000010", form: "10-Q", role: "primary", sourceFile: "q.htm", reportDate: "2026-09-30", plain: "Third Quarter Guidance\nNet sales are expected to be $200 billion." });
    const pack = buildCohortPack([release, quarterly], { contextTokens: 32768, generatedAt: "now" });
    expect(pack.coverage.periods).toBe(1);
    expect(pack.containers[0].cohortId).toBe("2026-09-30");
    expect(pack.containers[0].containerId).toBe("2026-09-30__001");
    expect(pack.containers[0].sources.map((source) => source.sourceId)).toEqual(["quarterly", "source-a"]);
  });

  it("keeps undated filings in separate cohorts instead of inventing a shared period", () => {
    const a = doc({ reportDate: "" });
    const b = doc({ sourceId: "source-b", accessionNo: "0000000-26-000002", sourceFile: "b.htm", reportDate: "" });
    const pack = buildCohortPack([a, b], { contextTokens: 32768, generatedAt: "now" });
    expect(pack.coverage.periods).toBe(2);
    expect(pack.containers.map((container) => container.cohortId)).toEqual(["unresolved:0000000-26-000001", "unresolved:0000000-26-000002"]);
  });
});
