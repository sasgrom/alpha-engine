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
