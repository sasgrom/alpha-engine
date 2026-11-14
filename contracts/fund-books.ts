/**
 * Quarter-end books of the tracked funds as filed on Form 13F, rebuilt from the cached information tables by
 * scripts/build-fund-books.mts: every row of a table summed per security, values in dollars, all filings of a
 * quarter merged. The fund-flow view is built on these files.
 */
export const FUND_BOOKS_SCHEMA_VERSION = 1;

export interface FundBookEntry {
  fund: number;
  /** Name on the cover page of the latest filing used. */
  manager: string | null;
  /** Accession numbers that make up the book: the latest full report and the additions after it. */
  filings: string[];
  /** Filings on record for the quarter, including the ones a restatement replaced. */
  filed: number;
  /** Latest signature date among the filings used. */
  signed: string | null;
  /** Value of every share position filed, covered or not, in dollars. */
  book: number;
  /** Value of the positions in covered companies, in dollars. */
  covered: number;
  /** Covered companies held. */
  positions: number;
  /** Securities with shares in the filings used. */
  securities: number;
  /** Value of the shares underlying reported options on covered companies. */
  optionsCovered: { puts: number; calls: number };
  /** The same over everything filed. */
  options: { puts: number; calls: number };
  /** Value filed as principal amounts (bonds and notes). */
  principal: number;
  /** A filing used stated its values in thousands of dollars. */
  thousands: boolean;
  /** Rows and value read from the tables equal the totals on the cover pages. */
  totalsAgree: boolean;
}

export interface FundBooksQuarter {
  schemaVersion: number;
  quarter: string;
  codeVersion: string;
  funds: FundBookEntry[];
  /**
   * One row per fund and covered company: fund CIK, company CIK, shares, dollars. Shares are on today's split basis
   * and in units of the company's main share class, so an unchanged holding is the same number in every quarter.
   */
  positions: [fund: number, company: number, shares: number, value: number][];
}

export interface FundBooksManifest {
  schemaVersion: number;
  generatedAt: string;
  codeVersion: string;
  readerVersion: number;
  cache: string;
  filings: {
    total: number;
    read: number;
    reused: number;
    withoutCover: string[];
    originals: number;
    restatements: number;
    additions: number;
    unknownAmendments: string[];
    withoutPeriod: string[];
    /**
     * Rows and value read from each table against the totals its cover page states: equal; equal but for a factor
     * of 1,000 (the cover in another unit than the table); the row count differs; the value differs; not stated.
     * `noTable`: the cached file has no row although the cover states some (it is a copy of the cover page: the
     * table was filed confidentially or was not found). `partTable`: under half the stated rows and value.
     */
    totals: { agree: number; valueThousandfold: number; rowsDiffer: number; valueDiffers: number; notStated: number; noTable: number; partTable: number };
  };
  units: {
    /** Filings per decided unit and era. */
    counts: Record<string, number>;
    /** Filings whose prices fit no unit. */
    unknown: string[];
  };
  /** Fund-quarters without a book: `fund CIK|quarter`, with the reason. */
  fundQuartersLeftOut: { unreadableUnit: string[]; incompleteTable: string[] };
  /** Later additions to a report (holdings first filed confidentially) whose table is not in the cache; the report itself is used. */
  additionsNotRead: number;
  /**
   * Positions whose own price (value ÷ shares) is more than three times off the security's price in the other
   * books: shares and value contradict each other, and the smaller reading is kept. `valueLowered`: valued from
   * the share count at the price of the other books. `sharesLowered`: share count taken from the stated value.
   * `leftOut`: too few other books to compare with. `largest`: those above 5% of the fund's stated book in either
   * reading, with the larger reading and the ratio of the own price to the price in the other books.
   */
  positions: {
    valueLowered: number;
    sharesLowered: number;
    leftOut: number;
    largest: { fund: number; quarter: string; cusip: string; ticker: string; value: number; ratio: number }[];
  };
  securities: {
    /** Distinct securities in all filings. */
    seen: number;
    /** Securities the stored CUSIP map proposes for a covered company (by company or by ticker). */
    proposedByMap: number;
    /** Securities counted toward a covered company, and how each was established. */
    matched: number;
    matchedBy: Record<string, number>;
    /** Covered companies with at least one matched security, and the tickers of those without. */
    companies: number;
    companiesWithout: string[];
    /**
     * Every matched security: quarters tested against the company's stock, pairs of consecutive quarters and how
     * many of them fit, today's shares of the company's main class per filed share at the latest quarter, and the
     * value the security carries over all books.
     */
    list: { cusip: string; ticker: string; how: string; periods: number; pairs: number; consistent: number; factor: number; value: number }[];
    /** New CUSIPs matched to a predecessor with declining holders, shared funds and a company-specific price basis. */
    successors: { cusip: string; predecessor: string; company: string; firstQualifiedQuarter: string; t0: string; overlap: number; predecessorOverlap: number; priceRatio: number }[];
    /** Candidates that met the overlap and predecessor tests but were not unique. */
    ambiguous: { cusip: string; t0: string; candidates: { company: string; predecessor: string; overlap: number; predecessorOverlap: number; priceRatio: number }[] }[];
    /** Securities the map gives to one company while their prices are another company's. */
    mapCorrected: { cusip: string; mapped: string; matched: string }[];
    /** Securities the map proposes that the prices do not confirm. */
    rejected: { cusip: string; ticker: string; reason: string }[];
  };
  /** Stock splits seen in the books: the share basis of the company changed by `ratio` into the quarter named. */
  splits: { ticker: string; quarter: string; ratio: number }[];
  quarters: { quarter: string; funds: number; positions: number; companies: number; book: number; covered: number; sha256: string }[];
}
