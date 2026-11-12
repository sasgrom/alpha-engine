export interface XbrlContext {
  id: string;
  startDate: string | null;
  endDate: string | null;
  instant: string | null;
  dimensions: Record<string, string>;
}
export interface XbrlFact {
  id: string;
  concept: string;
  contextRef: string;
  value: number | null;
  rawValue: string;
  unitRef: string | null;
  format?: string | null;
  decimals: string | null;
  scale: string | null;
  sign: string | null;
  context: XbrlContext;
  excerpt: string;
}
export interface XbrlDocument {
  contexts: Map<string, XbrlContext>;
  facts: XbrlFact[];
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(value: string): string {
  return value.replace(/&([a-z]+|#\d+|#x[\da-f]+);/gi, (match, name) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return entities[name.toLowerCase()] ?? match;
  });
}
function text(value: string): string {
  return decode(value.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}
function attributes(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of value.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) result[match[1]] = decode(match[2]);
  return result;
}
function iso(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
function numeric(raw: string, sign: string | null, scale: string | null, format: string | null): number | null {
  if (format?.toLowerCase().includes("fixed-zero") && raw.trim()) return 0;
  const cleaned = raw.replace(/[,\s]/g, "").replace(/[−–—]/g, "-");
  const negative = cleaned.startsWith("(") && cleaned.endsWith(")") || sign === "-";
  const unsigned = cleaned.replace(/[()]/g, "").replace(/^[-+]/, "");
  if (!/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(unsigned)) return null;
  let value = Number(unsigned);
  if (!Number.isFinite(value)) return null;
  if (negative) value = -value;
  const exponent = scale === null ? 0 : Number(scale);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 15) return null;
  return value * 10 ** exponent;
}

export function parseXbrl(html: string): XbrlDocument {
  const contexts = new Map<string, XbrlContext>();
  for (const match of html.matchAll(/<(?:\w+:)?context\b([^>]*)>([\s\S]*?<\/(?:\w+:)?context>)/gi)) {
    const attrs = attributes(match[1]);
    const body = match[2];
    const id = attrs.id;
    if (!id) continue;
    const dimensions: Record<string, string> = {};
    for (const member of body.matchAll(/<(?:\w+:)?explicitMember\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?explicitMember>/gi)) {
      const dimension = attributes(member[1]).dimension;
      if (dimension) dimensions[dimension] = text(member[2]);
    }
    const startDate = iso(body.match(/<(?:\w+:)?startDate\b[^>]*>([^<]+)</i)?.[1]);
    const endDate = iso(body.match(/<(?:\w+:)?endDate\b[^>]*>([^<]+)</i)?.[1]);
    const instant = iso(body.match(/<(?:\w+:)?instant\b[^>]*>([^<]+)</i)?.[1]);
    contexts.set(id, { id, startDate, endDate, instant, dimensions });
  }
  const facts: XbrlFact[] = [];
  for (const match of html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi)) {
    const attrs = attributes(match[1]);
    const contextRef = attrs.contextRef;
    const context = contextRef ? contexts.get(contextRef) : undefined;
    if (!attrs.name || !contextRef || !context) continue;
    const rawValue = text(match[2]);
    facts.push({
      id: attrs.id ?? `${attrs.name}|${contextRef}|${facts.length}`,
      concept: attrs.name,
      contextRef,
      value: numeric(rawValue, attrs.sign ?? null, attrs.scale ?? null, attrs.format ?? null),
      rawValue,
      unitRef: attrs.unitRef ?? null,
      format: attrs.format ?? null,
      decimals: attrs.decimals ?? null,
      scale: attrs.scale ?? null,
      sign: attrs.sign ?? null,
      context,
      excerpt: match[0],
    });
  }
  return { contexts, facts };
}

export function exposurePeriod(fact: XbrlFact): { start: string | null; end: string | null; kind: "Q" | "H1" | "9M" | "FY" | "instant" | "other" } {
  const { startDate, endDate, instant } = fact.context;
  if (instant) return { start: null, end: instant, kind: "instant" };
  if (!startDate || !endDate) return { start: startDate, end: endDate, kind: "other" };
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
  if (days >= 70 && days <= 105) return { start: startDate, end: endDate, kind: "Q" };
  if (days >= 150 && days <= 220) return { start: startDate, end: endDate, kind: "H1" };
  if (days >= 240 && days <= 315) return { start: startDate, end: endDate, kind: "9M" };
  if (days >= 330 && days <= 385) return { start: startDate, end: endDate, kind: "FY" };
  return { start: startDate, end: endDate, kind: "other" };
}

export const REVENUE_CONCEPTS = new Set([
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
  "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
  "us-gaap:RegulatedAndUnregulatedOperatingRevenue",
  "us-gaap:Revenues",
  "us-gaap:SalesRevenueNet",
]);
export const GEOGRAPHY_AXES = new Set(["srt:StatementGeographicalAxis", "srt:GeographicalAreaAxis", "srt:GeographicAreaAxis"]);
export const PRODUCT_AXES = new Set(["srt:ProductOrServiceAxis", "srt:ProductOrServiceOtherAxis"]);
const foreignMember = /^(?:country:(?!US$)[A-Z]{2}$|[\w-]+:(?:ForeignCountriesMember|OtherForeignCountriesMember|ForeignMember|InternationalMember|CanadaMember|MexicoMember|ChinaMember|JapanMember|GermanyMember|UnitedKingdomMember|BrazilMember|AustraliaMember|IndiaMember|SingaporeMember|SouthKoreaMember|TaiwanMember|NetherlandsMember|FranceMember|ItalyMember|SpainMember|SwitzerlandMember|SwedenMember|NorwayMember|DenmarkMember|IrelandMember|BelgiumMember|IsraelMember|SaudiArabiaMember|UnitedArabEmiratesMember|QatarMember|KuwaitMember|SouthAfricaMember|InternationalMarketsMember|InternationalOperationsMember|OtherInternationalMember|RestOfWorldMember|EuropeMember|EuropeanUnionMember|EmeaMember|AsiaPacificMember|AsiaMember|OceaniaMember|AfricaMember|SouthAmericaMember|LatinAmericaMember|OtherCountriesMember|OtherRegionMember|OtherRegionsMember|OtherAmericasMember|NonUsMember|NonUSMember|NonUnitedStatesMember|MiddleEastMember|AmericasExcludingUsMember|AmericasExcludingUnitedStatesMember))$/i;
const domesticMember = /^(?:country:US|[\w-]+:(?:UnitedStatesMember|UnitedStatesOfAmericaMember|DomesticMember|UsMember|USMember))$/i;
const oilMember = /crude|natural.?gas|refined|petroleum|gasoline|diesel|jet.?fuel|lubricant|asphalt|kerosene|\boil\b|\bgas\b|\bngl\b|condensate|propane|butane|ethane/i;
const nonOilMember = /renewable|alternative|biofuel|solar|wind|geothermal|hydrogen|electricity|power|chemical|coal|mining|copper|molybdenum|gold|silver|nickel|aluminum|steel|mineral|ore|service|other|pipeline|transportation|storage|terminal/i;
const explicitOilSegments = new Set(["cvx:UpstreamSegmentMember", "cvx:DownstreamSegmentMember"]);

export function isForeignMember(member: string): boolean {
  return foreignMember.test(member) && !domesticMember.test(member);
}
export function isDomesticMember(member: string): boolean {
  return domesticMember.test(member);
}
export function isOilMember(member: string): boolean {
  return explicitOilSegments.has(member) || oilMember.test(member) && !nonOilMember.test(member);
}
export function hasAxis(fact: XbrlFact, axes: Set<string>): boolean {
  return Object.keys(fact.context.dimensions).some(axis => axes.has(axis));
}
export function members(fact: XbrlFact, axes: Set<string>): string[] {
  return Object.entries(fact.context.dimensions).filter(([axis]) => axes.has(axis)).map(([, member]) => member);
}
export function isUsd(fact: XbrlFact): boolean {
  const unit = fact.unitRef?.replace(/^U_/i, "").toLowerCase();
  return unit === "usd" || unit === "iso4217:usd";
}
