/**
 * Upcoming stock splits from Yahoo's split calendar (owner, 2026-11-13: "yahoo should have future split calendar ...
 * we can put it on daily watch"). Pure helpers: the request body, reading the answer, keeping US listings, and the
 * share ratio. The fetch itself is worker/split-calendar.mts.
 */

export interface UpcomingSplit {
  ticker: string;
  company: string;
  /** the first session on the new basis (Yahoo's startdatetime, a US market date) */
  date: string;
  /** new shares per old share: 4 for a 4-for-1 split, 0.05 for a 1-for-20 reverse split */
  ratio: number;
  oldShares: number;
  newShares: number;
  optionable: boolean | null;
}

/** Yahoo's calendar query for splits starting on or after `from` and before `until` (YYYY-MM-DD). */
export function splitCalendarQuery(from: string, until: string, offset = 0, size = 250) {
  return {
    sortType: "ASC",
    entityIdType: "splits",
    sortField: "startdatetime",
    includeFields: ["ticker", "companyshortname", "startdatetime", "optionable", "old_share_worth", "share_worth"],
    query: { operator: "and", operands: [{ operator: "gte", operands: ["startdatetime", from] }, { operator: "lt", operands: ["startdatetime", until] }] },
    offset,
    size,
  };
}

/** A US listing: no exchange suffix (0381.HK, PASHUPATI.NS and EFY.MU are listings elsewhere); BRK-B stays. */
export const isUsListing = (ticker: string) => /^[A-Z][A-Z0-9-]{0,9}$/.test(ticker);

/** The calendar's rows (columns by name) as splits; rows without a date or share counts are dropped. */
export function readSplitCalendar(answer: any): UpcomingSplit[] {
  const document = answer?.finance?.result?.[0]?.documents?.[0];
  if (!document) return [];
  const columns: string[] = (document.columns ?? []).map((column: any) => column.id);
  const at = (name: string) => columns.indexOf(name);
  const out: UpcomingSplit[] = [];
  for (const row of document.rows ?? []) {
    const ticker = String(row[at("ticker")] ?? "").trim().toUpperCase();
    const when = String(row[at("startdatetime")] ?? "");
    const oldShares = Number(row[at("old_share_worth")]), newShares = Number(row[at("share_worth")]);
    if (!ticker || !/^\d{4}-\d{2}-\d{2}/.test(when) || !(oldShares > 0) || !(newShares > 0)) continue;
    const optionable = row[at("optionable")];
    out.push({ ticker, company: String(row[at("companyshortname")] ?? ""), date: when.slice(0, 10), ratio: newShares / oldShares, oldShares, newShares,
      optionable: typeof optionable === "boolean" ? optionable : null });
  }
  return out;
}

/** The share ratio as a person reads it: "4-for-1", "1-for-20". */
export const ratioText = (split: Pick<UpcomingSplit, "oldShares" | "newShares">) => `${split.newShares}-for-${split.oldShares}`;
