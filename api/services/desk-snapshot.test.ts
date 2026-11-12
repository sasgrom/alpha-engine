import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deskSnapshotFor, readDeskSnapshot } from "./desk-snapshot";
import type { DeskSnapshot } from "@contracts/desk-snapshot";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function snapshotFile(body: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "desk-snapshot-"));
  dirs.push(dir);
  const file = path.join(dir, "desk-snapshot.json");
  writeFileSync(file, JSON.stringify(body));
  return file;
}

const company = { ticker: "AAPL", options: { capturedAt: "2026-11-11T12:00:00Z", rv20: 0.2, ivRvSpread: 0.05, buckets: [] } };

describe("desk snapshot service", () => {
  it("returns null before a snapshot exists and re-reads the file when it changes", () => {
    expect(readDeskSnapshot(path.join(tmpdir(), "no-such-desk-snapshot.json"))).toBeNull();
    const file = snapshotFile({ schemaVersion: 1, session: "2026-11-10", companies: [] });
    expect(readDeskSnapshot(file)?.session).toBe("2026-11-10");
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, session: "2026-11-11", companies: [] }));
    utimesSync(file, new Date(), new Date(Date.now() + 5_000));
    expect(readDeskSnapshot(file)?.session).toBe("2026-11-11");
  });

  it("refuses a snapshot of another schema version", () => {
    expect(() => readDeskSnapshot(snapshotFile({ schemaVersion: 2, companies: [] }))).toThrow(/schema 2/);
  });

  it("removes option fields for users outside the presentation audience only", () => {
    const snapshot = { schemaVersion: 1, companies: [company] } as unknown as DeskSnapshot;
    expect(deskSnapshotFor(snapshot, true).companies[0].options).not.toBeNull();
    expect(deskSnapshotFor(snapshot, false).companies[0].options).toBeNull();
    expect(snapshot.companies[0].options).not.toBeNull();
  });
});
