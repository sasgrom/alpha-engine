import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneRunLogs } from "./run-log-retention";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const NOW = Date.parse("2026-11-22T12:00:00Z");
const DAY = 86_400_000;

function folder(files: Array<[name: string, ageDays: number]>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "run-log-retention-"));
  dirs.push(dir);
  for (const [name, ageDays] of files) {
    const file = path.join(dir, name);
    writeFileSync(file, "log line\n");
    const when = new Date(NOW - ageDays * DAY);
    utimesSync(file, when, when);
  }
  return dir;
}

describe("run log retention", () => {
  it("removes run logs older than the limit and keeps newer ones", () => {
    const dir = folder([["1795000000000-stocktwits-hourly.log", 20], ["1795000000001-schwab-fetch-daily.log", 13], ["1795000000002-alpha-bridge-agent.log", 15]]);
    const result = pruneRunLogs({ dir, days: 14, nowMs: NOW });
    expect(result).toMatchObject({ scanned: 3, removed: 2, kept: 1, failed: 0, bytesRemoved: 18 });
    expect(readdirSync(dir)).toEqual(["1795000000001-schwab-fetch-daily.log"]);
  });

  it("never touches files that are not per-run logs", () => {
    const names = ["operations-scheduler.log", "home-server.log", "operations-state.json", "1795000000000-notes.txt", "run.log"];
    const dir = folder(names.map((name) => [name, 400]));
    expect(pruneRunLogs({ dir, days: 14, nowMs: NOW })).toMatchObject({ scanned: 0, removed: 0 });
    expect(readdirSync(dir).sort()).toEqual([...names].sort());
  });

  it("reports without deleting in a dry run, and refuses a limit under one day", () => {
    const dir = folder([["1795000000000-stocktwits-hourly.log", 30]]);
    expect(pruneRunLogs({ dir, days: 14, nowMs: NOW, dryRun: true }).removed).toBe(1);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(() => pruneRunLogs({ dir, days: 0, nowMs: NOW })).toThrow("days must be at least 1");
  });
});
