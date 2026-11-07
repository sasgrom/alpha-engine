import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildToneReviewedData, TONE_MODEL, TONE_PROMPT_SOURCE_SHA256, TONE_PROMPT_VERSION, versionedTonePayloadKey } from "./export-edgar-tone-reviewed.mts";
import { tonePrompt } from "../worker/lib/ollama";
import type { ManifestEntry } from "../worker/edgar-fetch.mts";

const companies = Array.from({ length: 50 }, (_, index) => ({ cik: index + 1, ticker: `T${String(index + 1).padStart(2, "0")}` }));
const accession = "0000000000-26-000001";
const manifest = (overrides: Partial<ManifestEntry> = {}): ManifestEntry => ({
  accessionNo: accession,
  form: "10-Q",
  filingDate: "2026-11-06",
  reportDate: "2026-09-30",
  primaryDoc: "report.htm",
  eventTs: "2026-11-06 00:00:00",
  docName: "report.htm",
  fetched: true,
  scored: true,
  ...overrides,
});
const manifests = new Map(companies.map((company) => [company.cik, [manifest()]]));
let id = 0;
const raw = (cik: number, overrides: Record<string, unknown> = {}) => ({
  id: ++id,
  cik,
  source: "edgar",
  signalType: "tone",
  eventTs: "2026-11-06 00:00:00",
  score: 0.2,
  magnitude: 1,
  payloadKey: `llm:${TONE_MODEL}:edgar:${cik}:${accession}`,
  src: "backfill",
  note: "Unchanged note",
  ...overrides,
});

describe("reviewed EDGAR tone export", () => {
  it("builds a versioned key and preserves the legacy key", () => {
    expect(versionedTonePayloadKey(TONE_MODEL, "v1", 1375365, accession)).toBe(`llm:${TONE_MODEL}:prompt=v1:edgar:1375365:${accession}`);
    const { signals } = buildToneReviewedData(companies.map((company) => raw(company.cik)), companies, manifests);
    expect(signals).toHaveLength(50);
    expect(signals[0].payloadKey).toBe(`llm:${TONE_MODEL}:prompt=v1:edgar:1:${accession}`);
    expect(signals[0].legacyPayloadKey).toBe(`llm:${TONE_MODEL}:edgar:1:${accession}`);
    expect(signals[0].promptVersion).toBe("v1");
    expect(signals[0].promptSourceSha256).toBe(TONE_PROMPT_SOURCE_SHA256);
  });

  it("computes per-ticker forms, counts and event range without rewriting notes", () => {
    const rows = companies.map((company) => raw(company.cik));
    rows[0].eventTs = "2020-01-02 03:04:05";
    const { signals, coverage } = buildToneReviewedData(rows, companies, manifests);
    expect(coverage.minEventTs).toBe("2020-01-02 03:04:05");
    expect(coverage.maxEventTs).toBe("2026-11-06 00:00:00");
    expect(coverage.companiesWithSignals).toBe(50);
    expect(coverage.outsideUniverseRows).toBe(0);
    expect(coverage.companies[0].forms["10-Q"]).toBe(1);
    expect(signals[0].note).toBe("Unchanged note");
  });

  it("rejects outside-universe rows and duplicate exact keys", () => {
    expect(() => buildToneReviewedData([raw(1037540)], companies, manifests)).toThrow("outsideUniverseRows");
    expect(() => buildToneReviewedData([raw(1), raw(1)], companies, manifests)).toThrow("Duplicate legacy exact key");
  });

  it("rejects invalid score, magnitude, src and oversized note", () => {
    expect(() => buildToneReviewedData([raw(1, { score: 1.1 })], companies, manifests)).toThrow("Invalid score");
    expect(() => buildToneReviewedData([raw(1, { magnitude: 0 })], companies, manifests)).toThrow("Invalid magnitude");
    expect(() => buildToneReviewedData([raw(1, { src: "live" })], companies, manifests)).toThrow("Invalid src");
    expect(() => buildToneReviewedData([raw(1, { note: "x".repeat(2001) })], companies, manifests)).toThrow("Oversized note");
  });

  it("requires fetched/scored manifest lineage and the canonical model", () => {
    expect(() => buildToneReviewedData([raw(1, { payloadKey: `llm:other:edgar:1:${accession}` })], companies, manifests)).toThrow("Unexpected model");
    const unscored = new Map(companies.map((company) => [company.cik, [manifest({ scored: false })]]));
    expect(() => buildToneReviewedData([raw(1)], companies, unscored)).toThrow("Missing fetched/scored manifest link");
  });

  it("pins the canonical active tone prompt source hash", () => {
    expect(TONE_PROMPT_VERSION).toBe("v1");
    expect(TONE_PROMPT_SOURCE_SHA256).toBe(createHash("sha256").update(tonePrompt.toString()).digest("hex"));
    expect(TONE_PROMPT_SOURCE_SHA256).toHaveLength(64);
  });
});
