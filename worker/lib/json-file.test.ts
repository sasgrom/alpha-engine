import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renameWithRetry, writeJsonAtomic } from "./json-file";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function failing(code: string, times: number) {
  let calls = 0;
  const rename = () => {
    calls++;
    if (calls <= times) throw Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
  };
  return { rename, calls: () => calls };
}

describe("renameWithRetry", () => {
  it("waits out a transient Windows lock instead of failing the writer", () => {
    for (const code of ["EPERM", "EBUSY", "EACCES"]) {
      const lock = failing(code, 3);
      renameWithRetry("a.tmp", "a.json", { rename: lock.rename, waitMs: 0 });
      expect(lock.calls()).toBe(4);
    }
  });

  it("still throws a lock that outlasts every attempt, and any other error at once", () => {
    const stuck = failing("EPERM", 100);
    expect(() => renameWithRetry("a.tmp", "a.json", { rename: stuck.rename, attempts: 5, waitMs: 0 })).toThrow(/EPERM/);
    expect(stuck.calls()).toBe(5);
    const missing = failing("ENOENT", 100);
    expect(() => renameWithRetry("a.tmp", "a.json", { rename: missing.rename, waitMs: 0 })).toThrow(/ENOENT/);
    expect(missing.calls()).toBe(1);
  });
});

describe("writeJsonAtomic", () => {
  it("replaces the file and leaves no temporary file behind", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "json-file-"));
    dirs.push(dir);
    const file = path.join(dir, "state.json");
    writeJsonAtomic(file, { n: 1 });
    writeJsonAtomic(file, { n: 2 }, true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ n: 2 });
  });
});
