export interface ExchangeCompanyRow {
  cik: number;
  name: string;
  ticker: string;
  exchange: string | null;
}

const PREFERRED_NAME =
  /\b(?:PREFERRED|PREFERENCE|DEPOSITARY|DEBENTURE|WARRANT|RIGHTS?|UNITS?|NOTES?|BONDS?)\b/i;
const PREFERRED_TICKER = /[-/]P[A-Z]?$/i;

/** Return each currently exchange-listed common-share class; preferred-only issuers are excluded. */
export function commonStockListings<T extends ExchangeCompanyRow>(
  rows: T[]
): T[] {
  return rows.filter(
    row =>
      Number.isInteger(row.cik) &&
      row.cik > 0 &&
      row.ticker.trim() &&
      row.exchange?.trim() &&
      !PREFERRED_NAME.test(row.name) &&
      !PREFERRED_TICKER.test(row.ticker)
  );
}
