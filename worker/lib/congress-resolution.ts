import type { CongressTrade, ResolvedCongressTrade } from "./congress";
import type { CompanyIndex } from "./news-companies";

export type CongressResolutionMethod = "original" | "case+company-name" | "company-name" | "leading-symbol" | "unresolved";

export function congressAssetName(asset: string): { name: string; leadingTicker: string | null } {
  const leading = asset.match(/^([A-Z][A-Z0-9.]{1,11})-([A-Z].+)$/);
  const name = (leading?.[2] ?? asset)
    .replace(/\s*\((?:[A-Z][A-Z0-9.$-]{0,11}|NYSE|NASDAQ|NYSE American|OTC[^)]*)\)/gi, " ")
    .replace(/\s*\[[A-Z]{2}\]/gi, " ")
    .replace(/\bCommon units representing limited partner interests\b/gi, " ")
    .replace(/\bClass\s+[A-Z]\b/gi, " ")
    .replace(/\bCommon Stock\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s,;-]+$/g, "")
    .trim();
  return { name, leadingTicker: leading?.[1] ?? null };
}

export function resolveCongressTradeHistorical(index: CompanyIndex, trade: ResolvedCongressTrade): ResolvedCongressTrade & { resolutionMethod: CongressResolutionMethod } {
  if (trade.resolution === "resolved" || trade.assetType !== "stock") return { ...trade, resolutionMethod: "original" };
  if (/\b(?:ETF|exchange traded fund|index fund|mutual fund|notes?|bonds?)\b|Rate\/Coupon:|Matures:|Real Estate Income Trust/i.test(trade.asset)) return { ...trade, resolutionMethod: "unresolved" };
  const cleaned = congressAssetName(trade.asset);
  const ticker = trade.ticker?.toUpperCase() ?? cleaned.leadingTicker;
  const candidates = index.candidates(cleaned.name, ticker, 8);
  const best = index.resolve(cleaned.name, ticker);
  const resolved = best?.match === "prefix" ? null : best;
  const resolutionMethod: CongressResolutionMethod = !trade.ticker && cleaned.leadingTicker ? "leading-symbol" : trade.ticker && trade.ticker !== ticker ? "case+company-name" : "company-name";
  return {
    ...trade,
    resolution: resolved ? "resolved" : candidates.length ? "ambiguous" : "not a company",
    cik: resolved?.cik ?? null,
    candidates,
    resolutionMethod: resolved ? resolutionMethod : "unresolved",
  };
}
