/**
 * Load the committed worker universe without requiring database access.
 * Regenerate the snapshot with scripts/export-worker-universe.mts when membership changes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export interface UniverseEntry {
  cik: number;
  ticker: string;
  name: string;
  gdeltQuery: string;
}

export function loadUniverse(): UniverseEntry[] {
  const file = path.resolve(import.meta.dirname, "..", "universe.json");
  const rows = JSON.parse(readFileSync(file, "utf8")) as UniverseEntry[];
  return rows.filter((row) => row.cik && row.ticker);
}

/** Filing pipelines process each CIK once; a current ticker wins over a _PRE alias. */
export function dedupeExpectationUniverse<T extends { cik: number; ticker: string }>(companies: T[]): T[] {
  const byCik = new Map<number, T>();
  for (const company of companies) {
    const previous = byCik.get(company.cik);
    if (!previous || (previous.ticker.endsWith("_PRE") && !company.ticker.endsWith("_PRE"))) byCik.set(company.cik, company);
  }
  return [...byCik.values()];
}
