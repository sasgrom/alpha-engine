import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { currentMacroInputHashes, hashMacroInputs } from "./macro-input-lineage";

let root: string | null = null;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("macro input lineage", () => {
  it("tracks content rather than file write time and reports unavailable inputs", () => {
    root = mkdtempSync(path.join(tmpdir(), "macro-lineage-"));
    const file = path.join(root, "series.json");
    writeFileSync(file, JSON.stringify([{ value: 1 }]));
    const first = hashMacroInputs({ "fred:DGS10": file });
    writeFileSync(file, JSON.stringify([{ value: 1 }]));
    expect(hashMacroInputs({ "fred:DGS10": file })).toEqual(first);
    expect(currentMacroInputHashes({ "fred:DGS10": file })).toEqual(first);

    writeFileSync(file, JSON.stringify([{ value: 2 }]));
    expect(currentMacroInputHashes({ "fred:DGS10": file })["fred:DGS10"]).not.toBe(first["fred:DGS10"]);
    expect(currentMacroInputHashes({ "fred:DGS10": path.join(root, "missing.json") })["fred:DGS10"]).toBeNull();
  });
});
