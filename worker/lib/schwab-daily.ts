import type { PriceBar } from "../../api/services/prices";

export interface SchwabDailyCandle {
  datetime?: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
}

export interface OfficialDailyConflictEvidence {
  date: string;
  candidates: { volume: number | null; fetchedAt: string }[];
  selected: { volume: number | null; fetchedAt: string };
}

export interface OfficialDailyBar extends PriceBar {
  fetchedAt?: Date | string | null;
  conflictEvidence?: OfficialDailyConflictEvidence;
}

export function latestCompletedSchwabDailyDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(value("year")), month = Number(value("month")), day = Number(value("day")), hour = Number(value("hour"));
  if (!year || !month || !day || !Number.isInteger(hour)) throw new Error("Invalid Schwab daily session cutoff");
  const utcDay = Date.UTC(year, month - 1, day);
  return new Date(utcDay - (hour < 16 ? 86_400_000 : 0)).toISOString().slice(0, 10);
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteVolume(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function completeOfficialDailyBar(bar: PriceBar): boolean {
  return finitePositive(bar.open) && finitePositive(bar.high) && finitePositive(bar.low) &&
    finitePositive(bar.close) && finiteVolume(bar.volume) && bar.high >= bar.low;
}

/** Normalize official daily candles without substituting intraday/options data. */
export function officialDailyBars(payload: { candles?: SchwabDailyCandle[] }, latestLocalDate: string): OfficialDailyBar[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latestLocalDate)) throw new Error("Invalid latest local date");
  const byDate = new Map<string, { bar: OfficialDailyBar; datetime: number }>();
  for (const candle of Array.isArray(payload?.candles) ? payload.candles : []) {
    if (!Number.isFinite(candle.datetime) || !finitePositive(candle.close)) continue;
    const datetime = candle.datetime!;
    const date = new Date(datetime).toISOString().slice(0, 10);
    if (date > latestLocalDate) continue;
    const bar: OfficialDailyBar = {
      date,
      open: candle.open ?? null,
      high: candle.high ?? null,
      low: candle.low ?? null,
      close: candle.close,
      adjClose: null,
      volume: candle.volume ?? null,
    };
    const previous = byDate.get(date);
    if (previous) {
      const sameOhlc = previous.bar.open === bar.open && previous.bar.high === bar.high && previous.bar.low === bar.low && previous.bar.close === bar.close;
      if (!sameOhlc || (previous.datetime === datetime && previous.bar.volume !== bar.volume)) throw new Error(`Conflicting official daily candle for ${date}`);
      if (previous.datetime === datetime) continue;
      const candidates = [
        ...(previous.bar.conflictEvidence?.candidates ?? [{ volume: previous.bar.volume, fetchedAt: new Date(previous.datetime).toISOString() }]),
        { volume: bar.volume, fetchedAt: new Date(datetime).toISOString() },
      ];
      const selected = datetime > previous.datetime ? { bar, datetime } : previous;
      selected.bar.conflictEvidence = {
        date,
        candidates,
        selected: { volume: selected.bar.volume, fetchedAt: new Date(selected.datetime).toISOString() },
      };
      byDate.set(date, selected);
      continue;
    }
    byDate.set(date, { bar, datetime });
  }
  return [...byDate.values()].map(({ bar }) => bar).sort((a, b) => a.date.localeCompare(b.date));
}

export function latestCompleteOfficialDailyBars(payload: { candles?: SchwabDailyCandle[] }, latestLocalDate: string, count = 2): OfficialDailyBar[] {
  if (!Number.isInteger(count) || count < 2) throw new Error("At least two official daily bars are required");
  const bars = officialDailyBars(payload, latestLocalDate);
  const latest = bars.slice(-count);
  if (latest.length !== count || latest.some((bar) => !completeOfficialDailyBar(bar))) {
    throw new Error(`Expected ${count} complete official daily candles with OHLCV`);
  }
  return latest;
}

export interface ExistingOfficialBar extends OfficialDailyBar {
  id: number;
  ticker: string;
  fetchedAt: Date | string | null;
}

/** Fill only missing OHLCV fields; confirmed values and original availability stay unchanged. */
export function officialBarEnrichment(existing: ExistingOfficialBar, candidate: OfficialDailyBar): Partial<Pick<OfficialDailyBar, "open" | "high" | "low" | "volume">> {
  if (existing.date !== candidate.date || existing.close !== candidate.close) throw new Error(`Conflicting Schwab close for ${existing.ticker}/${candidate.date}`);
  if (existing.adjClose !== null || candidate.adjClose !== null) throw new Error(`Unexpected adjusted Schwab close for ${existing.ticker}/${candidate.date}`);
  const patch: Partial<Pick<OfficialDailyBar, "open" | "high" | "low" | "volume">> = {};
  for (const field of ["open", "high", "low", "volume"] as const) {
    const before = existing[field];
    const after = candidate[field];
    if (before !== null && after !== null && before !== after) throw new Error(`Conflicting Schwab ${field} for ${existing.ticker}/${candidate.date}`);
    if (before === null && after !== null) patch[field] = after;
  }
  return patch;
}
