/**
 * The registry ticker of a company is its traded common share.
 *
 * SEC's ticker directory lists every security of a filer under the same CIK (common, preferred, warrants, notes),
 * so "the directory row of this CIK" is not a company's ticker: taking the last row stored MER-PK for Bank of
 * America and ORCL-PD for Oracle. For index members the GICS snapshot is the authority (it carries the common
 * share, and both classes of the three two-class members); for everything else the explicitly requested ticker.
 * This rule was first delivered on 2026-11-05 and lost twice to commits made from a stale checkout; the registry
 * audit below is also run by the desk snapshot build, so a regression shows up in the data, not only in a test.
 */
import { GICS_BY_CIK, GICS_SP500 } from "./gics-snapshot";

export interface SecDirectoryCompany {
  cik: number;
  name: string;
  ticker: string;
  exchange: string;
}

export function canonicalTicker(cik: number, requestedTicker: string): string {
  const shareClass = GICS_SP500.find((entry) => entry.cik === cik && entry.ticker === requestedTicker);
  if (shareClass) return shareClass.ticker;
  return GICS_BY_CIK.get(cik)?.ticker ?? requestedTicker;
}

export function exactSecDirectoryEntry(entries: SecDirectoryCompany[], cik: number, ticker: string): SecDirectoryCompany | null {
  return entries.find((entry) => entry.cik === cik && entry.ticker === ticker) ?? null;
}

export interface RegistryRow {
  cik: number;
  ticker: string;
  sector: string | null;
  industry: string | null;
}

export interface RegistryCorrection {
  cik: number;
  field: "ticker" | "sector" | "industry";
  before: string | null;
  after: string;
}

/**
 * What must change so that the registry rows of index members agree with the GICS snapshot. A ticker that is not
 * one of the member's index tickers becomes the traded ticker (the one its prices are fetched under) when that is
 * an index ticker of the same CIK, otherwise the snapshot's; a missing sector or industry is filled from the
 * snapshot. Rows of companies outside the index are never touched.
 */
export function registryCorrections(rows: RegistryRow[], tradedTicker: Map<number, string> = new Map()): RegistryCorrection[] {
  const corrections: RegistryCorrection[] = [];
  for (const row of rows) {
    const gics = GICS_BY_CIK.get(row.cik);
    if (!gics) continue;
    const ticker = canonicalTicker(row.cik, row.ticker);
    if (ticker !== row.ticker) {
      corrections.push({ cik: row.cik, field: "ticker", before: row.ticker, after: canonicalTicker(row.cik, tradedTicker.get(row.cik) ?? ticker) });
    }
    if (!row.sector) corrections.push({ cik: row.cik, field: "sector", before: row.sector, after: gics.sector });
    if (!row.industry) corrections.push({ cik: row.cik, field: "industry", before: row.industry, after: gics.industry });
  }
  return corrections.sort((a, b) => a.cik - b.cik || a.field.localeCompare(b.field));
}
