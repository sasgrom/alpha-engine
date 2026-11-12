import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFundFlowsFile } from "./fund-flows-files";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "desk-flows-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "fund"), { recursive: true });
  return dir;
}

describe("fund-flow files", () => {
  it("answers null before the build has run and rereads a file that changed", () => {
    const dir = root();
    expect(readFundFlowsFile("overview.json", dir)).toBeNull();
    const file = path.join(dir, "fund", "1067983.json");
    writeFileSync(file, JSON.stringify({ cik: 1067983, name: "Berkshire Hathaway" }));
    expect(readFundFlowsFile<{ name: string }>("fund/1067983.json", dir)?.name).toBe("Berkshire Hathaway");
    writeFileSync(file, JSON.stringify({ cik: 1067983, name: "Berkshire Hathaway Inc" }));
    utimesSync(file, new Date(), new Date(Date.now() + 5_000));
    expect(readFundFlowsFile<{ name: string }>("fund/1067983.json", dir)?.name).toBe("Berkshire Hathaway Inc");
  });

  it("refuses an overview of another schema version", () => {
    const dir = root();
    writeFileSync(path.join(dir, "overview.json"), JSON.stringify({ schemaVersion: 2, quarters: [] }));
    expect(() => readFundFlowsFile("overview.json", dir)).toThrow(/schema 2/);
    writeFileSync(path.join(dir, "overview.json"), JSON.stringify({ schemaVersion: 1, quarters: [] }));
    utimesSync(path.join(dir, "overview.json"), new Date(), new Date(Date.now() + 9_000));
    expect(readFundFlowsFile<{ quarters: unknown[] }>("overview.json", dir)?.quarters).toEqual([]);
  });
});
