import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { publishedStandardDir } from "./published-standard";

const root = mkdtempSync(path.join(tmpdir(), "published-standard-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the published build of a refreshed standard", () => {
  it("is the fallback before the first refresh", () => {
    expect(publishedStandardDir(path.join(root, "none.json"), "D:/accepted-by-hand")).toBe("D:/accepted-by-hand");
  });

  it("is the folder the pointer names", () => {
    const build = path.join(root, "20261124T113500Z");
    mkdirSync(build);
    const pointer = path.join(root, "current.json");
    writeFileSync(pointer, JSON.stringify({ schemaVersion: 1, dir: build, buildVersion: "i1.1.20261124" }));
    expect(publishedStandardDir(pointer, "D:/accepted-by-hand")).toBe(build);
  });

  it("stops on a pointer without a folder or to a folder that is not there, never falling back", () => {
    const empty = path.join(root, "empty.json"), gone = path.join(root, "gone.json");
    writeFileSync(empty, JSON.stringify({ schemaVersion: 1 }));
    writeFileSync(gone, JSON.stringify({ schemaVersion: 1, dir: path.join(root, "missing") }));
    expect(() => publishedStandardDir(empty, "D:/accepted-by-hand")).toThrow(/names no build folder/);
    expect(() => publishedStandardDir(gone, "D:/accepted-by-hand")).toThrow(/not there/);
  });
});
