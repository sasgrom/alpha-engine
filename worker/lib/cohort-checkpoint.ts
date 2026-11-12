import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { writeJsonAtomic } from "./json-file";
import type { CohortPack } from "./cohort-pack";
import type { ExpectationResponse } from "./expectations";
import type { ExpectationFallback } from "./expectation-fallback";

export interface CohortUsage { promptTokens: number; evalCount: number; promptMs: number; evalMs: number; totalMs: number }
export interface CohortResultEntry {
  cik: number;
  ticker: string;
  cohortId: string;
  containerId: string;
  sourceId: string;
  accessionNo: string;
  form: string;
  filingDate: string;
  eventTs: string;
  reportDate: string;
  sourceFile: string;
  inputSha256: string;
  model: string;
  promptVersion: string;
  status: "extracted" | "empty" | "unparsed" | "request_failed" | "fallback" | "fallback_unverified";
  guidanceStatus: ExpectationResponse["guidanceStatus"] | null;
  statements: ExpectationResponse["statements"];
  extractionWarnings: string[];
  rejectedEvidence: number;
  rawResponse: string | null;
  fallback: (ExpectationFallback & { evidenceVerified: boolean }) | null;
  fallbackRawResponse: string | null;
  fallbackUsage: CohortUsage | null;
  usage: CohortUsage | null;
  outputTokens?: number;
  outputTruncated?: boolean;
  updatedAt: string;
}
export interface CohortResultFile {
  schemaVersion: number;
  contextTokens: number;
  packGeneratedAt: string;
  unpacked: CohortPack["unpacked"];
  entries: CohortResultEntry[];
}
interface CohortEntryKey { containerId?: string; sourceId: string; updatedAt?: string }

const entryKey = (entry: CohortEntryKey) => `${entry.containerId ?? ""}\n${entry.sourceId}`;
const snapshotPath = (cacheDir: string) => path.join(cacheDir, "cohort-v2.json");
const entryDirectory = (cacheDir: string) => path.join(cacheDir, "cohort-v2-entries");
const entryPath = (cacheDir: string, entry: CohortEntryKey) => `${entryDirectory(cacheDir)}/${createHash("sha256").update(entryKey(entry)).digest("hex")}.json`;

export function clearCohortEntryCache(cacheDir: string): void {
  rmSync(entryDirectory(cacheDir), { recursive: true, force: true });
}

/** One completed SOURCE_ID per atomic file: no full-company JSON rewrite per document. */
export function writeCohortEntryAtomic(cacheDir: string, entry: CohortResultEntry): void {
  writeJsonAtomic(entryPath(cacheDir, entry), entry, false);
}

export function writeCohortResultSnapshot(cacheDir: string, result: CohortResultFile): void {
  writeJsonAtomic(snapshotPath(cacheDir), result, true);
}

function readSnapshot(cacheDir: string): CohortResultFile | null {
  try { return JSON.parse(readFileSync(snapshotPath(cacheDir), "utf8")) as CohortResultFile; }
  catch { return null; }
}

/** Merge the last company snapshot with newer per-source checkpoints after any restart. */
export function readCohortEntries<T extends CohortEntryKey>(cacheDir: string): T[] {
  const entries = new Map<string, T>();
  const snapshot = readSnapshot(cacheDir);
  for (const entry of snapshot?.entries ?? []) entries.set(entryKey(entry), entry as unknown as T);
  const directory = entryDirectory(cacheDir);
  if (existsSync(directory)) {
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
      const entry = JSON.parse(readFileSync(path.join(directory, file), "utf8")) as T;
      const key = entryKey(entry);
      const prior = entries.get(key);
      if (!prior || (entry.updatedAt ?? "") >= (prior.updatedAt ?? "")) entries.set(key, entry);
    }
  }
  return [...entries.values()].sort((a, b) => (a.containerId ?? "").localeCompare(b.containerId ?? "") || a.sourceId.localeCompare(b.sourceId));
}

export function readCohortResult(cacheDir: string, fallback?: Omit<CohortResultFile, "entries">): CohortResultFile | null {
  const snapshot = readSnapshot(cacheDir);
  const entries = readCohortEntries<CohortResultEntry>(cacheDir);
  if (snapshot) return { ...snapshot, entries };
  return fallback && entries.length ? { ...fallback, entries } : null;
}
