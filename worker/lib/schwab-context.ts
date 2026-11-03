import { sha256Text } from "./schwab-normalize";

export interface SchwabMarketSession { date: string; isOpen: boolean; isHoliday: boolean; regularMarket: { start: string; end: string }[] }
export interface SchwabMover { symbol: string; description: string | null; last: number | null; change: number | null; percentChange: number | null; volume: number | null; direction: "up" | "down" | "flat" | "unknown" }
export interface SchwabInstrumentProfile { symbol: string; cusip: string | null; description: string | null; exchange: string | null; assetType: string | null; assetMainType: string | null; fundamental: Record<string, string | number | boolean | null> }
export interface SchwabIntradayBar { datetime: number; open: number; high: number; low: number; close: number; volume: number }
export interface SchwabIntradaySeries { ticker: string; frequencyMinutes: number; bars: SchwabIntradayBar[]; vwap: number | null; openingRangeHigh: number | null; openingRangeLow: number | null; lastClose: number | null }
export interface SchwabContextFile { kind: string; capturedAt: string; sourceHash: string; status: "complete" | "failed"; error?: string }
export interface SchwabContextReport {
  schemaVersion: 1;
  generatedAt: string;
  provider: "schwab";
  coverage: { expected: number; complete: number; errors: number };
  hours: Record<string, SchwabMarketSession>;
  movers: { index: string; rows: SchwabMover[] }[];
  instruments: SchwabInstrumentProfile[];
  intraday: SchwabIntradaySeries[];
  files: SchwabContextFile[];
}
const num = (value: unknown): number | null => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const sourceHash = (raw: string) => sha256Text(raw);

/** Build the market-hours request with the query parameter required by Schwab. */
export function schwabMarketHoursPath(market: "equity" | "option"): string {
  return `markets?markets=${encodeURIComponent(market)}`;
}

export function parseMarketHours(raw: string, capturedAt: string): SchwabMarketSession {
  const doc = JSON.parse(raw) as Record<string, unknown>;
  const equity = (doc.equity ?? {}) as Record<string, unknown>;
  const option = (doc.option ?? {}) as Record<string, unknown>;
  const candidates = [equity.EQ, option.OPTION, equity, option, doc.EQ, doc.OPTION, doc].filter((value): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value));
  const container = candidates.find((value) => "sessionHours" in value || "date" in value) ?? candidates[0] ?? {};
  const hours = (container.sessionHours ?? {}) as Record<string, unknown>;
  const regular = Array.isArray(hours.regularMarket) ? hours.regularMarket.map((row) => {
    const value = row as Record<string, unknown>;
    return { start: String(value.start ?? ""), end: String(value.end ?? "") };
  }).filter((row) => row.start && row.end) : [];
  return { date: text(container.date) ?? capturedAt.slice(0, 10), isOpen: container.isOpen === true, isHoliday: container.isHoliday === true, regularMarket: regular };
}

export function parseMovers(raw: string): SchwabMover[] {
  const doc = JSON.parse(raw) as unknown;
  if (!Array.isArray(doc)) return [];
  return doc.map((value) => {
    const row = value as Record<string, unknown>;
    const instrument = (row.instrument ?? {}) as Record<string, unknown>;
    const percentChange = num(row.percentChange ?? row.netPercentChange);
    const rawDirection = text(row.direction)?.toLowerCase();
    const direction: SchwabMover["direction"] = rawDirection === "up" || rawDirection === "down" || rawDirection === "flat"
      ? rawDirection : percentChange === null ? "unknown" : percentChange > 0 ? "up" : percentChange < 0 ? "down" : "flat";
    return {
      symbol: String(row.symbol ?? instrument.symbol ?? "UNKNOWN"),
      description: text(row.description ?? instrument.description),
      last: num(row.last ?? row.lastPrice ?? instrument.lastPrice),
      change: num(row.change ?? row.netChange),
      percentChange,
      volume: num(row.totalVolume ?? row.volume),
      direction,
    };
  }).filter((row) => row.symbol !== "UNKNOWN").sort((a, b) => Math.abs(b.percentChange ?? 0) - Math.abs(a.percentChange ?? 0));
}

export function parseInstrument(raw: string, fallbackSymbol: string): SchwabInstrumentProfile {
  const doc = JSON.parse(raw) as Record<string, unknown> & { instruments?: Record<string, unknown>[] };
  const candidate = (Array.isArray(doc.instruments) ? doc.instruments[0] ?? {} : doc[fallbackSymbol] ?? doc) as Record<string, unknown>;
  const fundamental: Record<string, string | number | boolean | null> = {};
  if (candidate.fundamental && typeof candidate.fundamental === "object" && !Array.isArray(candidate.fundamental)) {
    for (const [key, value] of Object.entries(candidate.fundamental as Record<string, unknown>)) {
      if (["string", "number", "boolean"].includes(typeof value) || value === null) fundamental[key] = value as string | number | boolean | null;
    }
  }
  return {
    symbol: String(candidate.symbol ?? fallbackSymbol), cusip: text(candidate.cusip), description: text(candidate.description),
    exchange: text(candidate.exchange), assetType: text(candidate.assetType), assetMainType: text(candidate.assetMainType), fundamental,
  };
}

export function summarizeIntraday(ticker: string, raw: string, frequencyMinutes = 5): SchwabIntradaySeries {
  const doc = JSON.parse(raw) as { candles?: Record<string, unknown>[] };
  const bars = (Array.isArray(doc.candles) ? doc.candles : []).map((row) => ({
    datetime: num(row.datetime) ?? 0, open: num(row.open) ?? 0, high: num(row.high) ?? 0, low: num(row.low) ?? 0, close: num(row.close) ?? 0, volume: num(row.volume) ?? 0,
  })).filter((bar) => bar.datetime > 0 && bar.close > 0).sort((a, b) => a.datetime - b.datetime);
  const latestDay = bars.length ? new Date(bars[bars.length - 1].datetime).toISOString().slice(0, 10) : null;
  const session = latestDay ? bars.filter((bar) => new Date(bar.datetime).toISOString().slice(0, 10) === latestDay) : [];
  const volume = session.reduce((total, bar) => total + bar.volume, 0);
  const vwap = volume > 0 ? session.reduce((total, bar) => total + ((bar.high + bar.low + bar.close) / 3) * bar.volume, 0) / volume : null;
  const opening = session.slice(0, Math.max(1, Math.round(30 / frequencyMinutes)));
  return {
    ticker, frequencyMinutes, bars,
    vwap,
    openingRangeHigh: opening.length ? Math.max(...opening.map((bar) => bar.high)) : null,
    openingRangeLow: opening.length ? Math.min(...opening.map((bar) => bar.low)) : null,
    lastClose: bars.length ? bars[bars.length - 1].close : null,
  };
}

export function buildSchwabContextReport(params: {
  generatedAt: string;
  capturedAt: string;
  hours: { equity: string; option: string };
  movers: { SPX: string; COMPX: string; DJI: string };
  instruments: Record<string, string>;
  intraday: Record<string, string>;
  files: SchwabContextFile[];
}): SchwabContextReport {
  const { generatedAt, capturedAt, hours, movers, instruments, intraday, files } = params;
  return {
    schemaVersion: 1, generatedAt, provider: "schwab",
    coverage: { expected: 7 + Object.keys(instruments).length, complete: files.filter((file) => file.status === "complete").length, errors: files.filter((file) => file.status === "failed").length },
    hours: { equity: parseMarketHours(hours.equity, capturedAt), option: parseMarketHours(hours.option, capturedAt) },
    movers: Object.entries(movers).map(([index, raw]) => ({ index, rows: parseMovers(raw) })),
    instruments: Object.entries(instruments).map(([symbol, raw]) => parseInstrument(raw, symbol)).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    intraday: Object.entries(intraday).map(([ticker, raw]) => summarizeIntraday(ticker, raw)),
    files,
  };
}

export function contextSourceHash(raw: string): string { return sourceHash(raw); }
