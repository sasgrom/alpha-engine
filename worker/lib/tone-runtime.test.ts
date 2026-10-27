import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./json-file";
import { tokensPerSecond, unionDurationMs } from "./tone-metrics";
import { CACHE_SKIP, prepareToneFiling } from "./tone-prep";
import type { ManifestEntry } from "../edgar-fetch.mts";

describe("tone runtime safety", () => {
  it("counts overlapping request intervals only once", () => {
    expect(unionDurationMs([
      { start: 0, end: 10 }, { start: 5, end: 15 }, { start: 20, end: 25 },
    ])).toBe(20);
    expect(unionDurationMs([])).toBe(0);
  });

  it("computes token rates from total durations and handles zero safely", () => {
    expect(tokensPerSecond(120, 2000)).toBe(60);
    expect(tokensPerSecond(120, 0)).toBe(0);
  });

  it("atomically replaces JSON without leaving temporary files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "alpha-json-"));
    const file = path.join(dir, "manifest.json");
    try {
      writeJsonAtomic(file, { rows: [1, 2] }, true);
      writeJsonAtomic(file, { rows: [3] }, true);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ rows: [3] });
      expect(readdirSync(dir)).toEqual(["manifest.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses EX-99 for 8-K/A instead of scoring the cover", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "alpha-tone-prep-"));
    const accessionNo = "0000000000-24-000001";
    const base = accessionNo.replace(/-/g, "");
    const m: ManifestEntry = {
      accessionNo, form: "8-K/A", filingDate: "2024-01-02", reportDate: "2024-01-01",
      primaryDoc: "cover.htm", eventTs: "2024-01-02 12:00:00", docName: "cover.htm",
      fetched: true, scored: false, exFile: "ex99.htm", exChecked: true,
    };
    try {
      writeFileSync(path.join(dir, `${base}.htm`), "<html><body>cover only</body></html>");
      writeFileSync(path.join(dir, `${base}.ex.htm`), "<html><body>Item 2.02 Results of Operations\nRevenue rose 25% and management raised annual guidance.\nSIGNATURES</body></html>");
      const prep = prepareToneFiling(dir, m);
      if (!prep.ok) throw new Error(`unexpected skip: ${prep.reason}`);
      expect(prep.windows).toHaveLength(1);
      expect(prep.windows[0]).toContain("Revenue rose 25%");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports an unreadable cache without invoking the model", () => {
    const m: ManifestEntry = {
      accessionNo: "0000000000-24-000002", form: "10-K", filingDate: "2024-01-02",
      reportDate: "2023-12-31", primaryDoc: "missing.htm", eventTs: "2024-01-02 12:00:00",
      docName: "missing.htm", fetched: true, scored: false,
    };
    expect(prepareToneFiling("/definitely/missing", m)).toEqual({ ok: false, reason: CACHE_SKIP });
  });
});
