/**
 * Reads the per-company files built by scripts/build-desk-company.mts (worker/.runs/desk-company). Parsed files are
 * kept while their modification time and size are unchanged; the cache is bounded. A missing file is null: the page
 * says the statements are not built for that company, it does not guess.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DESK_COMPANY_SCHEMA_VERSION } from "@contracts/desk-company";

const MAX_CACHED = 60;
const cache = new Map<string, { mtimeMs: number; size: number; value: unknown }>();

export function deskCompanyRoot(): string {
  return path.resolve(process.cwd(), "worker/.runs/desk-company");
}

export function readDeskCompanyFile<T extends { schemaVersion: number }>(relative: string, root: string = deskCompanyRoot()): T | null {
  const file = path.join(root, relative);
  if (!existsSync(file)) return null;
  const { mtimeMs, size } = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) {
    cache.delete(file);
    cache.set(file, hit);
    return hit.value as T;
  }
  const value = JSON.parse(readFileSync(file, "utf8")) as T;
  if (value.schemaVersion !== DESK_COMPANY_SCHEMA_VERSION) {
    throw new Error(`Desk company file schema ${String(value.schemaVersion)} is not the expected ${DESK_COMPANY_SCHEMA_VERSION}; rebuild it`);
  }
  cache.set(file, { mtimeMs, size, value });
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return value;
}
