import { createHash } from "node:crypto";

export interface NportIdentifier {
  tag: string;
  value: string;
  description?: string;
}

export interface NportHolding {
  name: string;
  title: string;
  cusip: string | null;
  isin: string | null;
  identifiers: NportIdentifier[];
  shares: number;
  valueUsd: number;
  weightPct: number;
  assetCategory: string;
  issuerCategory: string | null;
  investmentCountry: string | null;
}

export interface ExcludedNportHolding extends NportHolding {
  reason: string;
}

export interface NportReport {
  seriesId: string;
  reportDate: string;
  reportingPeriodEnd: string | null;
  holdings: NportHolding[];
  excluded: ExcludedNportHolding[];
}

export interface MatchedHolding extends NportHolding {
  cik: number | null;
  matchSource:
    | "cusip"
    | "isin"
    | "name"
    | "name-order-free"
    | "ticker"
    | "openfigi-ticker"
    | "openfigi-name"
    | null;
  matchedName: string | null;
  trackingStock: boolean;
}

export interface MembershipLine {
  name: string;
  cusip: string | null;
  isin: string | null;
  weightPct: number;
  trackingStock: boolean;
  securityKey: string;
}

export interface CompanyMembership {
  cik: number;
  lines: MembershipLine[];
  weightPct: number;
}

export interface NameIdentity {
  cik: number;
  name: string;
  kind: "current" | "former";
  from?: string;
  to?: string;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function xmlBlocks(xml: string, tag: string): string[] {
  return [
    ...xml.matchAll(
      new RegExp(
        `<(?:[a-z_][\\w.-]*:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-z_][\\w.-]*:)?${tag}>`,
        "gi"
      )
    ),
  ].map(match => match[1]);
}

function xmlValue(xml: string, tag: string): string | null {
  const match = xml.match(
    new RegExp(
      `<(?:[a-z_][\\w.-]*:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-z_][\\w.-]*:)?${tag}>`,
      "i"
    )
  );
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "")) : null;
}

function requiredNumber(value: string | null, field: string): number {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed))
    throw new Error(`N-PORT schema mismatch: invalid ${field}`);
  return parsed;
}

function identifiers(block: string, isin: string | null): NportIdentifier[] {
  const identifiersBlock = xmlBlocks(block, "identifiers")[0] ?? "";
  const values: NportIdentifier[] = [];
  for (const match of identifiersBlock.matchAll(
    /<([a-z_][\w.-]*)\b([^>]*)\/?\s*>/gi
  )) {
    const value = match[2].match(/\bvalue=["']([^"']*)["']/i);
    if (!value) continue;
    const description = match[2].match(
      /\b(?:otherDesc|description)=["']([^"']*)["']/i
    );
    values.push({
      tag: match[1],
      value: decodeXml(value[1]),
      ...(description ? { description: decodeXml(description[1]) } : {}),
    });
  }
  if (isin && !values.some(row => row.tag.toLowerCase() === "isin"))
    values.push({ tag: "isin", value: isin });
  return values;
}

function normalizeCusip(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9*#@]{9}$/.test(normalized) && normalized !== "000000000"
    ? normalized
    : null;
}

/** Parse the N-PORT primary XML without changing its source bytes. */
export function parseNportXml(xml: string): NportReport {
  if (!/<(?:[a-z_][\w.-]*:)?edgarSubmission[\s>]/i.test(xml))
    throw new Error("N-PORT schema mismatch: edgarSubmission is absent");
  const seriesId = xmlValue(xml, "seriesId");
  const reportDate = xmlValue(xml, "repPdDate");
  if (!seriesId || !/^S\d{9}$/.test(seriesId))
    throw new Error("N-PORT schema mismatch: seriesId is invalid");
  if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate))
    throw new Error("N-PORT schema mismatch: repPdDate is invalid");
  const holdings: NportHolding[] = [];
  const excluded: ExcludedNportHolding[] = [];
  for (const block of xmlBlocks(xml, "invstOrSec")) {
    const isinMatch = block.match(
      /<(?:[a-z_][\w.-]*:)?isin(?:\s[^>]*)?\bvalue=["']([^"']+)["'][^>]*\/?\s*>/i
    );
    const holding: NportHolding = {
      name: xmlValue(block, "name") ?? "",
      title: xmlValue(block, "title") ?? "",
      cusip: normalizeCusip(xmlValue(block, "cusip")),
      isin: isinMatch ? decodeXml(isinMatch[1]).toUpperCase() : null,
      identifiers: [],
      shares: requiredNumber(xmlValue(block, "balance"), "balance"),
      valueUsd: requiredNumber(xmlValue(block, "valUSD"), "valUSD"),
      weightPct: requiredNumber(xmlValue(block, "pctVal"), "pctVal"),
      assetCategory: (xmlValue(block, "assetCat") ?? "").toUpperCase(),
      issuerCategory: xmlValue(block, "issuerCat"),
      investmentCountry: xmlValue(block, "invCountry"),
    };
    holding.identifiers = identifiers(block, holding.isin);
    if (!holding.name)
      throw new Error("N-PORT schema mismatch: holding name is absent");
    if (holding.assetCategory === "EC") holdings.push(holding);
    else
      excluded.push({
        ...holding,
        reason: holding.assetCategory
          ? `assetCat:${holding.assetCategory}`
          : "assetCat:missing",
      });
  }
  return {
    seriesId,
    reportDate,
    reportingPeriodEnd: xmlValue(xml, "repPdEnd"),
    holdings,
    excluded,
  };
}

/** Normalize spelling, security labels, geographic suffixes and legal-form abbreviations. */
export function normalizeIssuerName(value: string): string {
  return value
    .replace(/\s+COMMON\s+STOCK\s+USD\s*[\d.]*\s*$/i, "")
    .replace(
      /\/(?:THE|OLD|US|USA|UK|UNITED STATES|NEW YORK NY|CAYMAN ISLANDS|[A-Z]{2})\/?\s*$/i,
      ""
    )
    .normalize("NFKD")
    .replace(/[’‘]/g, "'")
    .replace(/&/g, " AND ")
    .toUpperCase()
    .replace(/\bINCORPORATED\b/g, "INC")
    .replace(/\bBANCORPORATION\b/g, "BANCORP")
    .replace(/\bCORPORATION\b/g, "CORP")
    .replace(/\bCOMPANIES\b/g, "CO")
    .replace(/\bCOMPANY\b/g, "CO")
    .replace(/\bCOS\b/g, "CO")
    .replace(/\bLIMITED\b/g, "LTD")
    .replace(/\bPUBLIC (?:LIMITED|LTD) CO\b/g, "PLC")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bS A\b/g, "SA")
    .replace(/\bN V\b/g, "NV")
    .replace(/\bS E\b/g, "SE")
    .replace(/\bA S\b/g, "AS")
    .replace(/\bA G\b/g, "AG")
    .replace(/\bB V\b/g, "BV")
    .replace(/\bL P\b/g, "LP")
    .replace(/\bL L C\b/g, "LLC")
    .replace(/\bP L C\b/g, "PLC")
    .replace(/\bU S A\b/g, "USA")
    .replace(/\bU S\b/g, "US");
}

export function secDisplayIssuerName(value: string): string {
  return value
    .replace(/\s*\(CIK\s*\d+\).*$/i, "")
    .replace(/\s*\([^)]*\)\s*$/i, "")
    .replace(/\s*\/[A-Z]{1,3}\/\s*$/i, "")
    .trim();
}

export function orderFreeIssuerName(value: string): string {
  const legalSuffixes = new Set([
    "INC",
    "CORP",
    "CO",
    "PLC",
    "NV",
    "LTD",
    "LLC",
    "LP",
    "SA",
    "SE",
    "AG",
    "BV",
    "AS",
  ]);
  const words = normalizeIssuerName(secDisplayIssuerName(value))
    .split(" ")
    .filter(Boolean)
    .filter(word => !legalSuffixes.has(word));
  while (words[0] === "THE" || words.at(-1) === "THE") {
    if (words[0] === "THE") words.shift();
    if (words.at(-1) === "THE") words.pop();
  }
  return words.sort().join(" ");
}

export function isTrackingStock(
  holding: Pick<NportHolding, "name" | "title">
): boolean {
  return /LIBERTY.*(?:FORMULA ONE|SIRIUS|BROADBAND|LIVE)|FORMULA ONE GROUP/i.test(
    `${holding.name} ${holding.title}`
  );
}

export function trackingIssuerName(
  holding: Pick<NportHolding, "name" | "title">
): string | null {
  if (/^LIBERTY MEDIA CORP(?:ORATION)?\b/i.test(holding.name))
    return "Liberty Media Corp";
  if (/^LIBERTY SIRIUS\s*XM\b/i.test(holding.name)) return "Liberty Media Corp";
  return null;
}

export function holdingTicker(holding: NportHolding): string | null {
  const identifier = holding.identifiers.find(
    row =>
      /^(?:ticker|tradingSymbol)$/i.test(row.tag) ||
      /^(?:ticker|trading symbol)$/i.test(row.description ?? "")
  );
  return identifier?.value.trim().toUpperCase() || null;
}

export interface FigiCandidate {
  ticker: string | null;
  name: string | null;
  exchange: string | null;
}

export interface HoldingMatcher {
  cusipToCik: ReadonlyMap<string, number>;
  nameToCik: ReadonlyMap<string, number>;
  orderFreeNameToCik?: ReadonlyMap<string, number>;
  tickerToCik?: ReadonlyMap<string, number>;
  figiByCusip?: ReadonlyMap<string, FigiCandidate[]>;
}

/** Apply unique date-valid name, own-identifier, active-ticker and OpenFIGI matches in order. */
export function matchHolding(
  holding: NportHolding,
  matcher: HoldingMatcher
): MatchedHolding {
  const trackingStock = isTrackingStock(holding);
  const result = (
    cik: number | null,
    matchSource: MatchedHolding["matchSource"],
    matchedName: string | null
  ): MatchedHolding => ({
    ...holding,
    cik,
    matchSource,
    matchedName,
    trackingStock,
  });
  const normalized = normalizeIssuerName(holding.name);
  const orderFree = orderFreeIssuerName(holding.name);
  const trackingIssuer = trackingIssuerName(holding);
  const orderFreeCik =
    matcher.orderFreeNameToCik?.get(orderFree) ??
    (trackingIssuer
      ? matcher.orderFreeNameToCik?.get(orderFreeIssuerName(trackingIssuer))
      : undefined);
  if (orderFreeCik) return result(orderFreeCik, "name-order-free", orderFree);

  const cusips = new Set<string>();
  if (holding.cusip) cusips.add(holding.cusip);
  if (holding.isin && /^(?:US|CA)[A-Z0-9]{10}$/.test(holding.isin))
    cusips.add(holding.isin.slice(2, 11));
  const ownCikSources = new Map<number, "cusip" | "isin">();
  for (const cusip of cusips) {
    const cik = matcher.cusipToCik.get(cusip);
    if (cik) ownCikSources.set(cik, cusip === holding.cusip ? "cusip" : "isin");
  }
  if (ownCikSources.size === 1) {
    const [cik, source] = [...ownCikSources][0];
    return result(cik, source, null);
  }
  const cikFromName = matcher.nameToCik.get(normalized);
  if (cikFromName) return result(cikFromName, "name", normalized);

  const ticker = holdingTicker(holding);
  const tickerCik = ticker
    ? matcher.tickerToCik?.get(ticker.replace(/\./g, "-"))
    : undefined;
  if (tickerCik) return result(tickerCik, "ticker", ticker ?? null);

  const figiCandidates = [...cusips].flatMap(
    cusip => matcher.figiByCusip?.get(cusip) ?? []
  );
  const figiTickerCiks = new Set<number>();
  for (const candidate of figiCandidates) {
    if (!candidate.ticker) continue;
    const cik = matcher.tickerToCik?.get(
      candidate.ticker.toUpperCase().replace(/\./g, "-")
    );
    if (cik) figiTickerCiks.add(cik);
  }
  if (figiTickerCiks.size === 1)
    return result([...figiTickerCiks][0], "openfigi-ticker", null);
  const figiNameCiks = new Set<number>();
  for (const candidate of figiCandidates) {
    if (!candidate.name) continue;
    const issuerName = candidate.name.replace(/-[A-Z]$/, "");
    const cik =
      matcher.orderFreeNameToCik?.get(orderFreeIssuerName(issuerName)) ??
      matcher.nameToCik.get(normalizeIssuerName(issuerName));
    if (cik) figiNameCiks.add(cik);
  }
  if (figiNameCiks.size === 1)
    return result([...figiNameCiks][0], "openfigi-name", null);
  return result(null, null, null);
}

/** Build a unique-only name index valid at the report date; ambiguity fails closed. */
export function buildNameIndex(
  identities: NameIdentity[],
  asOf?: string
): Map<string, number> {
  const ciksByName = new Map<string, Set<number>>();
  for (const identity of identities) {
    const from = identity.from?.slice(0, 10);
    const to = identity.to?.slice(0, 10);
    if (asOf && from && asOf < from) continue;
    if (asOf && to && asOf > to) continue;
    const normalized = normalizeIssuerName(secDisplayIssuerName(identity.name));
    if (!normalized) continue;
    const ciks = ciksByName.get(normalized) ?? new Set<number>();
    ciks.add(identity.cik);
    ciksByName.set(normalized, ciks);
  }
  return new Map(
    [...ciksByName]
      .filter(([, ciks]) => ciks.size === 1)
      .map(([name, ciks]) => [name, [...ciks][0]])
  );
}

export function buildOrderFreeNameIndex(
  identities: NameIdentity[],
  asOf?: string
): Map<string, number> {
  return buildNameIndex(
    identities.map(identity => ({
      ...identity,
      name: orderFreeIssuerName(identity.name),
    })),
    asOf
  );
}

/** Merge company membership while retaining every security and tracking-stock line. */
export function mergeCompanyMembership(
  holdings: MatchedHolding[]
): CompanyMembership[] {
  const companies = new Map<number, CompanyMembership>();
  for (const holding of holdings) {
    if (!holding.cik) continue;
    const company = companies.get(holding.cik) ?? {
      cik: holding.cik,
      lines: [],
      weightPct: 0,
    };
    company.lines.push({
      name: holding.name,
      cusip: holding.cusip,
      isin: holding.isin,
      weightPct: holding.weightPct,
      trackingStock: holding.trackingStock,
      securityKey: holding.cusip ?? holding.isin ?? holding.name,
    });
    company.weightPct += holding.weightPct;
    companies.set(holding.cik, company);
  }
  return [...companies.values()].sort((a, b) => a.cik - b.cik);
}

export interface ReportRef {
  accession: string;
  reportDate: string;
  filed: string;
  sha256: string;
}

/** Apply the specified conservative membership rule to one calendar date. */
export function latestReportOnOrBefore<T extends ReportRef>(
  reports: T[],
  date: string
): T | null {
  return (
    reports
      .filter(report => report.reportDate <= date)
      .sort(
        (a, b) =>
          a.reportDate.localeCompare(b.reportDate) ||
          a.filed.localeCompare(b.filed) ||
          a.accession.localeCompare(b.accession)
      )
      .at(-1) ?? null
  );
}

export function calendarQuarterEnds(start: string, newest: string): string[] {
  const result: string[] = [];
  const cursor = new Date(
    `${start.slice(0, 4)}-${start.slice(5, 7)}-01T00:00:00Z`
  );
  while (true) {
    const month = cursor.getUTCMonth();
    const quarterEndMonth = [2, 5, 8, 11].find(candidate => candidate >= month);
    if (quarterEndMonth === undefined) {
      cursor.setUTCFullYear(cursor.getUTCFullYear() + 1, 0, 1);
      continue;
    }
    const end = new Date(
      Date.UTC(cursor.getUTCFullYear(), quarterEndMonth + 1, 0)
    )
      .toISOString()
      .slice(0, 10);
    if (end > newest) break;
    if (end >= start) result.push(end);
    cursor.setUTCMonth(quarterEndMonth + 1, 1);
  }
  return result;
}

export function membershipAgreement(
  left: Set<number>,
  right: Set<number>
): number {
  const union = new Set([...left, ...right]);
  if (!union.size) return 1;
  let intersection = 0;
  for (const cik of union) if (left.has(cik) && right.has(cik)) intersection++;
  return intersection / union.size;
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
