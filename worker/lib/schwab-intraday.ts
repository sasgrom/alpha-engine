/**
 * Intraday prices every five minutes of a trading session (worker/schwab-intraday.mts): one batched quote snapshot of
 * every price series, five-minute bars built from consecutive snapshots, and the live prices the desk snapshot reads.
 * Sessions accumulate on D: and are never pruned; the desk reads at most five. Pure helpers here; the job does the requests and files.
 */
import type { SchwabMarketSession } from "./schwab-context";

/** One ticker in one snapshot: the regular session's last trade, the previous close and the day's running values. */
export interface IntradayQuote {
  last: number;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  /** Shares traded so far today (Schwab's total volume, pre-market included). */
  volume: number | null;
  /** The last regular-session trade, ms since epoch. */
  tradeTime: number | null;
  /** False when the provider explicitly marks the quote real-time; null when the response does not say. */
  delayed?: boolean | null;
}

export interface IntradaySnapshot {
  schemaVersion: 1;
  session: string;
  capturedAt: string;
  quotes: Record<string, IntradayQuote>;
}

/** A five-minute bar ending at `end` (the snapshot's capture time); its extremes are approximate. */
export interface IntradayBar { end: string; o: number; h: number; l: number; c: number; v: number | null }

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const positive = (value: unknown): number | null => { const n = finite(value); return n !== null && n > 0 ? n : null; };

/** Schwab's quotes response ({SYMBOL: {quote, regular, ...}}) as one IntradayQuote per symbol with a usable price. */
export function parseQuotes(body: unknown): Map<string, IntradayQuote> {
  const out = new Map<string, IntradayQuote>();
  if (!body || typeof body !== "object") return out;
  for (const [symbol, value] of Object.entries(body as Record<string, any>)) {
    const quote = value?.quote ?? {}, regular = value?.regular ?? {};
    const last = positive(regular.regularMarketLastPrice) ?? positive(quote.lastPrice);
    if (last === null) continue;
    out.set(symbol, {
      last,
      previousClose: positive(quote.closePrice),
      open: positive(quote.openPrice),
      high: positive(quote.highPrice),
      low: positive(quote.lowPrice),
      volume: finite(quote.totalVolume),
      tradeTime: finite(regular.regularMarketTradeTime) ?? finite(quote.tradeTime),
      delayed: typeof value?.realtime === "boolean" ? !value.realtime : typeof quote.delayed === "boolean" ? quote.delayed : null,
    });
  }
  return out;
}

export function symbolBatches(symbols: string[], size = 200): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += size) batches.push(symbols.slice(i, i + size));
  return batches;
}

/** Raw responses are retained only at 00/20/40 past the hour; every compact snapshot is retained. */
export function rawSnapshotDue(capturedAt: string): boolean {
  const date = new Date(capturedAt);
  if (!Number.isFinite(date.getTime())) return false;
  const minute = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", minute: "2-digit", hourCycle: "h23" }).format(date));
  return Number.isInteger(minute) && minute % 20 === 0;
}

/** Whether a snapshot belongs now: a trading day, from shortly before the regular session to shortly after it. */
export function sessionWindow(hours: SchwabMarketSession, now: Date, leadMinutes = 15, tailMinutes = 25): { open: boolean; reason: string } {
  if (!hours.isOpen || hours.isHoliday) return { open: false, reason: `market closed on ${hours.date}` };
  const regular = hours.regularMarket[0];
  if (!regular) return { open: false, reason: `no regular session on ${hours.date}` };
  const start = Date.parse(regular.start) - leadMinutes * 60_000, end = Date.parse(regular.end) + tailMinutes * 60_000;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { open: false, reason: "unreadable session hours" };
  if (now.getTime() < start) return { open: false, reason: `before the session (${regular.start})` };
  if (now.getTime() > end) return { open: false, reason: `after the session (${regular.end})` };
  return { open: true, reason: `session ${hours.date}` };
}

/**
 * Five-minute bars from a session's snapshots, oldest first. Open and close are the prices of consecutive snapshots (the
 * first bar opens at the day's open); high and low are the day's running high and low when a new one was set inside
 * the interval, else the larger and smaller of open and close (a quote snapshot does not see the interval's own
 * extremes); volume is the change in the day's volume.
 */
export function buildBars(snapshots: IntradaySnapshot[]): Record<string, IntradayBar[]> {
  const bars: Record<string, IntradayBar[]> = {};
  const previous = new Map<string, IntradayQuote>();
  for (const snapshot of [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
    for (const [ticker, quote] of Object.entries(snapshot.quotes)) {
      const before = previous.get(ticker);
      const o = before ? before.last : quote.open ?? quote.last, c = quote.last;
      const newHigh = quote.high !== null && (!before || before.high === null || quote.high > before.high) ? quote.high : null;
      const newLow = quote.low !== null && (!before || before.low === null || quote.low < before.low) ? quote.low : null;
      const v = quote.volume === null ? null : before?.volume !== null && before?.volume !== undefined ? Math.max(0, quote.volume - before.volume) : quote.volume;
      (bars[ticker] ??= []).push({ end: snapshot.capturedAt, o, h: Math.max(o, c, newHigh ?? -Infinity), l: Math.min(o, c, newLow ?? Infinity), c, v });
      previous.set(ticker, quote);
    }
  }
  return bars;
}

/** The desk's live prices: the snapshot's quotes with the moment of the latest regular-session trade. */
export interface LivePrices {
  schemaVersion: 1;
  session: string;
  capturedAt: string;
  /** The latest regular-session trade among the quotes (the prices are "as of" this moment). */
  asOf: string;
  quotes: Record<string, { last: number; previousClose: number | null; tradeTime: number | null }>;
}

export function livePrices(snapshot: IntradaySnapshot): LivePrices {
  let latest = 0;
  const quotes: LivePrices["quotes"] = {};
  for (const [ticker, quote] of Object.entries(snapshot.quotes)) {
    quotes[ticker] = { last: quote.last, previousClose: quote.previousClose, tradeTime: quote.tradeTime };
    if (quote.tradeTime !== null && quote.tradeTime > latest) latest = quote.tradeTime;
  }
  const asOf = latest > 0 && latest <= Date.parse(snapshot.capturedAt) + 60_000 ? new Date(latest).toISOString() : snapshot.capturedAt;
  return { schemaVersion: 1, session: snapshot.session, capturedAt: snapshot.capturedAt, asOf, quotes };
}
