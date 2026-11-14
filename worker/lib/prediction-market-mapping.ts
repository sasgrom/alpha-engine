import type { CompanyMappingEntry } from "../../contracts/prediction-markets";
import { excludedMarket, numericMarket, type JsonObject } from "./prediction-markets";

export interface CompanyRegistryRow { cik: number; name: string }
export type CompanyRegistry = Record<string, CompanyRegistryRow>;
export type CompanyNameKeys = Map<string, string>;

const NOISE = new Set(["INC", "CORP", "CORPORATION", "CO", "COMPANY", "THE", "HOLDINGS", "HOLDING", "GROUP", "LTD", "PLC", "LLC", "NV", "SA", "AG", "CLASS", "COM", "NEW", "DE", "AND", "OF", "INTERNATIONAL", "INDUSTRIES", "TECHNOLOGIES", "SYSTEMS"]);
const MARKET_FIGURE = /stock price|share price|market cap|close (above|below)|closing price|trade above|all.time high/i;
const MARKET_WIDE = /S&P|SP ?500|\bINX|NASDAQ|\bNDX|\bDOW\b|RUSSELL|\bVIX|\bINDEX|TREASURY|YIELD|\bBOND|BITCOIN|\bBTC|ETHEREUM|CRYPTO|\bGOLD\b|SILVER|\bOIL\b|\bWTI\b|BRENT|USD|EUR\/|\/USD|\bJPY|EXCHANGE RATE|INFLATION|\bCPI\b|\bGDP\b|FED FUNDS/i;
const GENERIC = new Set(["AMERICAN", "GENERAL", "FIRST", "UNITED", "NATIONAL", "GLOBAL", "SOUTHERN", "WESTERN", "EASTERN", "NORTHERN", "PACIFIC", "ATLANTIC", "DIGITAL", "ENERGY", "CAPITAL", "FINANCIAL", "HEALTH", "MEDICAL", "PUBLIC", "STATE", "WORLD", "UNIVERSAL", "ADVANCED", "APPLIED", "INTEGRATED", "DYNAMIC", "STANDARD", "CENTRAL", "CONSOLIDATED"]);
const MAX_MARKETS = 2000;

export function marketWideSeries(code: string, title: string): boolean {
  return MARKET_WIDE.test(code.replace(/^KX/i, "")) || MARKET_WIDE.test(title);
}

function words(name: string): string[] {
  return name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(word => word && !NOISE.has(word));
}

export function companyNameKeys(registry: CompanyRegistry): CompanyNameKeys {
  const keys: CompanyNameKeys = new Map();
  for (const [ticker, row] of Object.entries(registry)) {
    const parts = words(row.name);
    if (parts.length >= 2 && parts[0].length >= 3 && parts[1].length >= 3 && !keys.has(parts.slice(0, 2).join(" "))) keys.set(parts.slice(0, 2).join(" "), ticker);
    if (parts[0]?.length >= 5 && !GENERIC.has(parts[0]) && !keys.has(parts[0])) keys.set(parts[0], ticker);
  }
  return keys;
}

export function tickerGuess(seriesTicker: string, registry: CompanyRegistry): string | null {
  const core = seriesTicker.toUpperCase().replace(/^KX/, "");
  for (const candidate of [core, core.replace(/(KPI|ANNUAL|QUARTER|EARN|EPS|REV)$/, ""), core.replace(/[AQ]$/, ""), core.replace(/(KPI)?[AQ]?$/, "")]) if (candidate && registry[candidate]) return candidate;
  return null;
}

export function namesIn(text: string, keys: CompanyNameKeys): Set<string> {
  const upper = ` ${text.toUpperCase().replace(/[^A-Z0-9 ]/g, " ")} `;
  const found = new Set<string>();
  for (const [key, ticker] of keys) if (upper.includes(` ${key} `)) found.add(ticker);
  return found;
}

export function classifyCompanySeries(series: JsonObject, markets: JsonObject[], registry: CompanyRegistry, keys: CompanyNameKeys): { entry?: CompanyMappingEntry; rejected?: { series: string; title?: string; byTicker: string | null; named: string[]; markets: number; reason?: string } } {
  if (series.category !== "Companies" && series.category !== "Financials") return {};
  const code = String(series.ticker), title = String(series.title ?? "");
  if (marketWideSeries(code, title)) return {};
  const byTicker = tickerGuess(code, registry), byTitle = namesIn(title, keys);
  if (!byTicker && !byTitle.size) return {};
  if (excludedMarket(title, String(series.category ?? ""))) return {};
  const numbers = markets.filter(numericMarket);
  if (!numbers.length) return {};
  if (numbers.length > MAX_MARKETS) return { rejected: { series: code, title, byTicker, named: [...byTitle].sort(), markets: markets.length, reason: "too many markets: a daily range series" } };
  const byMarkets = namesIn(numbers.slice(0, 8).map(market => String(market.title ?? "")).join(" "), keys), named = new Set([...byTitle, ...byMarkets]);
  let ticker: string | null = null;
  if (byTicker && (!named.size || named.has(byTicker)) && named.size <= 1) ticker = byTicker;
  else if (!byTicker && named.size === 1) ticker = [...named][0];
  else if (byTicker && named.has(byTicker)) ticker = byTicker;
  if (!ticker) return { rejected: { series: code, title, byTicker, named: [...named].sort(), markets: markets.length } };
  const settled = numbers.filter(market => market.result === "yes" || market.result === "no"), open = numbers.filter(market => !market.result && ["active", "open", "initialized"].includes(String(market.status)));
  const kind = MARKET_FIGURE.test(`${title} ${numbers[0].title ?? ""}`) ? "market" as const : "business" as const;
  return { entry: { series: code, title, ticker, cik: registry[ticker].cik, kind, markets: numbers.length, settled: settled.length, open: open.length, events: new Set(numbers.map(market => market.event_ticker)).size, settledEvents: new Set(settled.map(market => market.event_ticker)).size, failedCandles: 0 } };
}
