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

/** One line of the Today page's filings feed. */
export interface WatchlistFiling {
  /** The accession number: one line per filing. */
  id: string;
  cik: number;
  ticker: string;
  form: string;
  filingDate: string;
  accessionNo: string;
  acceptedEt: string | null;
  earnings: boolean;
}

/**
 * The newest filings of the given companies from the desk's latest-filings file (already newest first). A missing
 * file gives an empty feed: the page says there is nothing to show, it does not fall back to another source.
 */
export function latestWatchlistFilings(file: { filings: Array<{ cik: number; ticker: string; accession: string; form: string; filed: string; acceptedEt: string | null; earnings: boolean }> } | null, ciks: number[], limit: number): WatchlistFiling[] {
  if (!file) return [];
  const wanted = new Set(ciks);
  const rows: WatchlistFiling[] = [];
  for (const filing of file.filings) {
    if (!wanted.has(filing.cik)) continue;
    rows.push({ id: filing.accession, cik: filing.cik, ticker: filing.ticker, form: filing.form, filingDate: filing.filed, accessionNo: filing.accession, acceptedEt: filing.acceptedEt, earnings: filing.earnings });
    if (rows.length >= limit) break;
  }
  return rows;
}
