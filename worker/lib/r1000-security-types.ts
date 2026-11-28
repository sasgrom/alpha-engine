import type { ExchangeCompanyRow } from "./russell1000-listed";

export interface R1000SecurityType extends ExchangeCompanyRow {
  assetType: string | null;
  assetSubType: string | null;
  description: string | null;
  exchangeName: string | null;
}

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

export function r1000SecurityType(row: ExchangeCompanyRow, quote: any): R1000SecurityType {
  const reference = quote?.reference ?? {};
  return {
    ...row,
    assetType: text(quote?.assetMainType) ?? text(quote?.assetType) ?? text(reference.assetType),
    assetSubType: text(quote?.assetSubType) ?? text(reference.assetSubType),
    description: text(reference.description) ?? text(quote?.description),
    exchangeName: text(reference.exchangeName) ?? text(quote?.exchangeName),
  };
}

export function r1000NonCommonReason(row: R1000SecurityType, handReviewedOtc = false): string | null {
  if (!row.assetType) return "unresolved-security-type";
  if (row.assetType.toUpperCase() !== "EQUITY") return `not-equity:${row.assetType}`;
  const subtype = row.assetSubType?.toUpperCase() ?? null;
  const description = row.description?.toUpperCase() ?? "";
  const exchange = (row.exchangeName ?? row.exchange ?? "").toUpperCase();
  if (/\bRECEIPT\b/.test(description)) return "otc-receipt";
  if (/OTC|PINK|GREY|GRAY/.test(exchange) && !handReviewedOtc) return "unapproved-otc-line";
  if (subtype === "COE") return null;
  if (subtype) return `non-common-subtype:${subtype}`;
  if (!/\bREIT\b/.test(description)) return "unverified-common-equity";
  if (!/NYSE|NASDAQ|CBOE|IEX/.test(exchange)) return "no-national-exchange";
  return null;
}
