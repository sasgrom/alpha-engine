import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readEngineFlowFile } from "./engine-flow-files";

const root = mkdtempSync(path.join(os.tmpdir(), "engine-flow-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("engine-flow files", () => {
  it("says an unreachable folder is an error, never an empty result", () => {
    expect(() => readEngineFlowFile("index.json", path.join(root, "drive-not-connected"))).toThrow(/not reachable/);
  });

  it("gives nothing for a file that is not built in a reachable folder", () => {
    expect(readEngineFlowFile("company/320193.json", root)).toBeNull();
  });

  it("refuses a file of another schema", () => {
    writeFileSync(path.join(root, "old.json"), JSON.stringify({ schemaVersion: 0 }));
    expect(() => readEngineFlowFile("old.json", root)).toThrow(/schema 0/);
  });

  it("reads a file and reads it again once it changes", () => {
    mkdirSync(path.join(root, "company"), { recursive: true });
    const file = path.join(root, "company", "99.json");
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, ticker: "TEST" }));
    expect(readEngineFlowFile<{ ticker: string }>("company/99.json", root)?.ticker).toBe("TEST");
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, ticker: "TEST2" }));
    expect(readEngineFlowFile<{ ticker: string }>("company/99.json", root)?.ticker).toBe("TEST2");
  });
});
