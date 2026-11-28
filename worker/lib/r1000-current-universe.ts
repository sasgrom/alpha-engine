import { commonStockListings, type ExchangeCompanyRow } from "./russell1000-listed";
import { r1000NonCommonReason, type R1000SecurityType } from "./r1000-security-types";

export type R1000InclusionReason = "member" | "former-listed";

export interface R1000CurrentUniverseRow {
  cik: number;
  ticker: string;
  tickers: string[];
  name: string;
  reason: R1000InclusionReason;
  lastQuarter: string;
}

export interface R1000UniverseCompany {
  cik: number;
  name: string;
  lastQuarter: string;
}

export interface R1000UniverseBuild {
  rows: R1000CurrentUniverseRow[];
  excluded: Array<{ cik: number; name: string; reason: string }>;
  excludedTickers: Array<{ cik: number; ticker: string; reason: string }>;
}

export function buildR1000CurrentUniverse(input: {
  companies: R1000UniverseCompany[];
  memberCiks: ReadonlySet<number>;
  registryCiks: ReadonlySet<number>;
  exchangeRows: ExchangeCompanyRow[];
  securityTypes: R1000SecurityType[];
  handReviewedOtc?: ReadonlySet<string>;
}): R1000UniverseBuild {
  const securityByTicker = new Map(input.securityTypes.map(row => [row.ticker, row]));
  const candidateCiks = new Set(input.companies.filter(row => !input.registryCiks.has(row.cik)).map(row => row.cik));
  const excludedTickers: R1000UniverseBuild["excludedTickers"] = [];
  const common = commonStockListings(input.exchangeRows).filter(row => {
    if (!candidateCiks.has(row.cik)) return false;
    const security = securityByTicker.get(row.ticker);
    const reason = security ? r1000NonCommonReason({ ...security, ...row }, input.handReviewedOtc?.has(row.ticker)) : "missing-security-type";
    if (reason) excludedTickers.push({ cik: row.cik, ticker: row.ticker, reason });
    return !reason;
  });
  const listings = new Map<number, string[]>();
  for (const row of common) {
    const tickers = listings.get(row.cik) ?? [];
    if (!tickers.includes(row.ticker)) tickers.push(row.ticker);
    tickers.sort();
    listings.set(row.cik, tickers);
  }
  const rows: R1000CurrentUniverseRow[] = [];
  const excluded: R1000UniverseBuild["excluded"] = [];
  for (const company of [...input.companies].sort((a, b) => a.cik - b.cik)) {
    if (input.registryCiks.has(company.cik)) {
      excluded.push({ cik: company.cik, name: company.name, reason: "already-in-registry" });
      continue;
    }
    const member = input.memberCiks.has(company.cik);
    const tickers = listings.get(company.cik) ?? [];
    if (!tickers.length) {
      excluded.push({ cik: company.cik, name: company.name, reason: "no-verified-common-stock-listing" });
      continue;
    }
    rows.push({
      cik: company.cik,
      ticker: tickers[0],
      tickers,
      name: company.name,
      reason: member ? "member" : "former-listed",
      lastQuarter: company.lastQuarter,
    });
  }
  return { rows, excluded, excludedTickers };
}

export function compareR1000Universe(previous: R1000CurrentUniverseRow[], current: R1000CurrentUniverseRow[]) {
  const before = new Map(previous.map(row => [row.cik, row]));
  const after = new Map(current.map(row => [row.cik, row]));
  return {
    joiners: current.filter(row => !before.has(row.cik)),
    leavers: previous.filter(row => !after.has(row.cik)),
  };
}

export function gateR1000CurrentUniverse(input: {
  rows: R1000CurrentUniverseRow[];
  exchangeRows: ExchangeCompanyRow[];
  securityTypes: R1000SecurityType[];
  handReviewedOtc?: ReadonlySet<string>;
  previous?: R1000CurrentUniverseRow[];
  newQuarterArrived: boolean;
}) {
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  const ciks = new Set(input.rows.map(row => row.cik));
  checks.push({ name: "unique-cik", pass: ciks.size === input.rows.length, detail: `${ciks.size}/${input.rows.length}` });
  const listed = new Set(input.exchangeRows.map(row => row.ticker));
  const unresolved = input.rows.flatMap(row => row.tickers.filter(ticker => !listed.has(ticker)).map(ticker => `${row.cik}/${ticker}`));
  checks.push({ name: "tickers-resolve", pass: unresolved.length === 0, detail: unresolved.join(",") || "all resolved" });
  const securityByTicker = new Map(input.securityTypes.map(row => [row.ticker, row]));
  const nonCommon = input.rows.flatMap(row => row.tickers.filter(ticker => {
    const security = securityByTicker.get(ticker);
    return !security || r1000NonCommonReason({ ...security, cik: row.cik }, input.handReviewedOtc?.has(ticker)) !== null;
  }).map(ticker => `${row.cik}/${ticker}`));
  checks.push({ name: "verified-common-equity", pass: nonCommon.length === 0, detail: nonCommon.join(",") || "every ticker verified" });
  checks.push({ name: "nonempty", pass: input.rows.length > 0, detail: `${input.rows.length} companies` });
  if (input.previous?.length && !input.newQuarterArrived) {
    const ratio = input.rows.length / input.previous.length;
    checks.push({ name: "within-five-percent", pass: ratio >= 0.95 && ratio <= 1.05,
                  detail: `${input.previous.length} -> ${input.rows.length}` });
  } else if (input.previous?.length) {
    checks.push({ name: "new-quarter-explained", pass: true,
                  detail: `${input.previous.length} -> ${input.rows.length}; see joiners/leavers` });
  }
  return { pass: checks.every(check => check.pass), checks };
}
