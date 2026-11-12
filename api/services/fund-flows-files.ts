/**
 * Reads the fund-flow files built by scripts/build-fund-flows.mts (worker/.runs/desk-flows): the overview and one
 * file per fund and per company. Parsed files are kept while their modification time and size are unchanged; the
 * per-entity cache is bounded. A missing file is null: the page says the build has not run, it does not guess.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { FUND_FLOWS_SCHEMA_VERSION } from "@contracts/fund-flows";

const MAX_CACHED = 80;
const cache = new Map<string, { mtimeMs: number; size: number; value: unknown }>();

export function fundFlowsRoot(): string {
  return path.resolve(process.cwd(), "worker/.runs/desk-flows");
}

export function readFundFlowsFile<T>(relative: string, root: string = fundFlowsRoot()): T | null {
  const file = path.join(root, relative);
  if (!existsSync(file)) return null;
  const { mtimeMs, size } = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) {
    // refresh its place so the files in use stay cached
    cache.delete(file);
    cache.set(file, hit);
    return hit.value as T;
  }
  const value = JSON.parse(readFileSync(file, "utf8")) as T & { schemaVersion?: number };
  if (relative === "overview.json" && value.schemaVersion !== FUND_FLOWS_SCHEMA_VERSION) {
    throw new Error(`Fund-flow overview schema ${String(value.schemaVersion)} is not the expected ${FUND_FLOWS_SCHEMA_VERSION}; rebuild it`);
  }
  cache.set(file, { mtimeMs, size, value });
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return value;
}
