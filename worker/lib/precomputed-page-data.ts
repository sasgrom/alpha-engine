import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./json-file";

export type PageDataMode = "precomputed" | "on_request";
export type PageDataParents = readonly string[];

interface SourceRun {
  runId: string;
  endedAt: string | null;
  status: string;
}

export interface PageDataVersion {
  evaluationDay: string | null;
  sourceRuns: Record<string, SourceRun | null>;
}

export interface PageDataArtifact<T> {
  schemaVersion: 1;
  key: string;
  generatedAt: string;
  codeVersion: string;
  inputs: unknown;
  inputsHash: string;
  version: PageDataVersion;
  versionHash: string;
  payload: T;
}

export interface PageDataResult<T> {
  payload: T;
  asOf: string | null;
  stale: boolean;
  dataMode: PageDataMode;
}

export interface PageDataOptions {
  key: string;
  parents: PageDataParents;
  root?: string;
  stateFile?: string;
  includeDay?: boolean;
  now?: Date;
}

interface WritePageDataOptions<T> extends PageDataOptions {
  payload: T;
  inputs: unknown;
  codeVersion: string;
}

function defaultRoot(): string {
  return path.resolve(process.cwd(), "worker", ".runs", "precomputed-page-data");
}

function artifactFile(key: string, root?: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error(`Invalid precomputed page-data key: ${key}`);
  return path.join(root ?? defaultRoot(), `${key}.json`);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function pageDataVersion(parents: PageDataParents, stateFile = path.resolve(process.cwd(), "worker", ".runs", "operations-state.json"), includeDay = true, now = new Date()): PageDataVersion {
  let lastRuns: Record<string, SourceRun | undefined> = {};
  let current: { jobId: string; runId: string; status: string } | null = null;
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    lastRuns = state.lastRuns ?? {};
    current = state.current ?? null;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  return {
    evaluationDay: includeDay ? now.toISOString().slice(0, 10) : null,
    sourceRuns: Object.fromEntries([...new Set(parents)].sort().map((parent) => {
      if (current?.jobId === parent) return [parent, { runId: String(current.runId), endedAt: null, status: String(current.status) }];
      const run = lastRuns[parent];
      return [parent, run ? { runId: String(run.runId), endedAt: run.endedAt ?? null, status: String(run.status) } : null];
    })),
  };
}

export function writePageDataArtifact<T>(options: WritePageDataOptions<T>): PageDataArtifact<T> {
  const now = options.now ?? new Date();
  const version = pageDataVersion(options.parents, options.stateFile, options.includeDay ?? true, now);
  const artifact: PageDataArtifact<T> = {
    schemaVersion: 1,
    key: options.key,
    generatedAt: now.toISOString(),
    codeVersion: options.codeVersion,
    inputs: options.inputs,
    inputsHash: hash(options.inputs),
    version,
    versionHash: hash(version),
    payload: options.payload,
  };
  writeJsonAtomic(artifactFile(options.key, options.root), artifact, true);
  return artifact;
}

export function readPageDataArtifact<T>(options: PageDataOptions): (PageDataArtifact<T> & { stale: boolean }) | null {
  try {
    const artifact = JSON.parse(readFileSync(artifactFile(options.key, options.root), "utf8")) as PageDataArtifact<T>;
    if (artifact.schemaVersion !== 1 || artifact.key !== options.key || !("payload" in artifact) || typeof artifact.versionHash !== "string") return null;
    const version = pageDataVersion(options.parents, options.stateFile, options.includeDay ?? true, options.now);
    const stale = artifact.versionHash !== hash(version) || Object.values(version.sourceRuns).some((run) => run !== null && run.status !== "done");
    return { ...artifact, stale };
  } catch {
    return null;
  }
}

export async function servePageData<T>(options: PageDataOptions & { compute: () => Promise<T> }): Promise<PageDataResult<T>> {
  const cached = readPageDataArtifact<T>(options);
  if (cached) return { payload: cached.payload, asOf: cached.generatedAt, stale: cached.stale, dataMode: "precomputed" };
  return { payload: await options.compute(), asOf: null, stale: false, dataMode: "on_request" };
}
