import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readDeskMacro } from "./desk-macro";

const folder = mkdtempSync(path.join(tmpdir(), "desk-macro-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
const point = (value: number) => ({ seriesId: "DGS10", label: "10Y Treasury yield", unit: "pct", date: "2026-11-19", value, availableAt: "2026-11-20T00:00:00.000Z" });

describe("the macro card's reader", () => {
  it("is empty when the file is not built", () => {
    expect(readDeskMacro(path.join(folder, "absent.json"))).toEqual([]);
  });

  it("returns the card's rows and re-reads a rebuilt file", () => {
    const file = path.join(folder, "desk-macro.json");
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, archiveGeneratedAt: "a", builtAt: "b", series: [point(4.2)] }));
    expect(readDeskMacro(file)).toEqual([{ seriesId: "DGS10", label: "10Y Treasury yield", unit: "pct", date: "2026-11-19", value: 4.2 }]);
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, archiveGeneratedAt: "a", builtAt: "c", series: [point(4.31)] }));
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(readDeskMacro(file)[0].value).toBe(4.31);
  });

  it("refuses a file of another schema", () => {
    const file = path.join(folder, "old.json");
    writeFileSync(file, JSON.stringify({ schemaVersion: 0, series: [] }));
    expect(() => readDeskMacro(file)).toThrow(/schema/);
  });
});
