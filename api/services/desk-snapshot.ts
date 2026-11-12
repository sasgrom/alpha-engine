/**
 * Desk view: the precomputed snapshot (scripts/build-desk-snapshot.mts) read from the reports folder the server
 * already serves, re-read only when the file changes. Option-derived fields are presentation content — the classic
 * Market data page is limited to the owner and to reviewers who accepted the NDA — so they are removed for everyone
 * else before the snapshot leaves the server.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DESK_SNAPSHOT_SCHEMA_VERSION, type DeskSnapshot } from "@contracts/desk-snapshot";
import { env } from "../lib/env";

let cache: { file: string; mtimeMs: number; size: number; snapshot: DeskSnapshot } | null = null;

export function deskSnapshotFile(): string {
  return path.resolve(process.cwd(), env.isProduction ? "dist/public/reports" : "public/reports", "desk-snapshot.json");
}

/** The snapshot, or null while none has been built. A file of another schema version is an error, not a guess. */
export function readDeskSnapshot(file: string = deskSnapshotFile()): DeskSnapshot | null {
  if (!existsSync(file)) return null;
  const { mtimeMs, size } = statSync(file);
  if (cache && cache.file === file && cache.mtimeMs === mtimeMs && cache.size === size) return cache.snapshot;
  const snapshot = JSON.parse(readFileSync(file, "utf8")) as DeskSnapshot;
  if (snapshot?.schemaVersion !== DESK_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Desk snapshot schema ${String(snapshot?.schemaVersion)} is not the expected ${DESK_SNAPSHOT_SCHEMA_VERSION}; rebuild it`);
  }
  cache = { file, mtimeMs, size, snapshot };
  return snapshot;
}

export function deskSnapshotFor(snapshot: DeskSnapshot, presentation: boolean): DeskSnapshot {
  if (presentation) return snapshot;
  return { ...snapshot, companies: snapshot.companies.map((company) => ({ ...company, options: null })) };
}
