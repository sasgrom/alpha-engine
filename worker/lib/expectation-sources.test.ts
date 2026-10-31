import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expectationSourcesFor } from "./expectation-sources";
import { dedupeExpectationUniverse } from "./universe";
import type { ManifestEntry } from "../edgar-fetch.mts";

const dirs: string[] = [];
const fixture = (form = "8-K") => {
  const dir = mkdtempSync(path.join(tmpdir(), "expectation-sources-"));
  dirs.push(dir);
  const accessionNo = "0000000-26-000001";
  const base = accessionNo.replace(/-/g, "");
  const entry: ManifestEntry = {
    accessionNo, form, filingDate: "2026-10-01", reportDate: "2026-09-30", primaryDoc: "main.htm", eventTs: "2026-10-01 12:00:00",
    docName: "main.htm", fetched: true, scored: false,
  };
  return { dir, entry, base };
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("expectation source paths", () => {
  it("uses the company directory once and preserves every exhibit", () => {
    const { dir, entry, base } = fixture();
    entry.exhibitFiles = [{ name: "main-ex.htm", size: 1, sha256: "a" }, { name: "supplement.htm", size: 1, sha256: "b" }];
    for (const file of entry.exhibitFiles) writeFileSync(path.join(dir, `${base}.ex-${file.name}`), "content");
    const sources = expectationSourcesFor(dir, entry);
    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.sourceFile.startsWith(dir))).toBe(true);
    expect(sources.some((source) => source.sourceFile.includes("1018724/1018724"))).toBe(false);
    expect(sources.every((source) => source.role === "exhibit")).toBe(true);
  });

  it("marks amendments without overwriting original chronology", () => {
    const { dir, entry, base } = fixture("8-K/A");
    writeFileSync(path.join(dir, `${base}.ex.htm`), "amended");
    entry.exFile = "legacy-ex.htm";
    const sources = expectationSourcesFor(dir, entry);
    expect(sources).toHaveLength(1);
    expect(sources[0].role).toBe("amendment");
    expect(sources[0].sourceFile).toBe(path.join(dir, `${base}.ex.htm`));
  });

  it("processes a shared CIK once and keeps an explicitly requested predecessor", () => {
    const xom = { cik: 34088, ticker: "XOM" };
    const predecessor = { cik: 34088, ticker: "XOM_PRE" };
    expect(dedupeExpectationUniverse([predecessor, xom])).toEqual([xom]);
    expect(dedupeExpectationUniverse([xom, predecessor])).toEqual([xom]);
    expect(dedupeExpectationUniverse([predecessor])).toEqual([predecessor]);
  });
});
