import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { prices } from "@db/schema";

export interface DailyPriceCandidate {
  id: number;
  cik: number;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  adjClose: number | null;
  volume: number | null;
  source: string;
  fetchedAt: Date | string;
}

export interface DailyPriceResult {
  status: "ready" | "stale" | "missing";
  cik: number;
  date: string;
  price: number | null;
  actualAsOf: string | null;
  currency: "USD";
  quality: "official_close" | "historical_backfill" | "stale" | "missing";
  source: string | null;
  fetchedAt: Date | string | null;
  bar: DailyPriceCandidate | null;
}

function timestamp(value: Date | string): number {
  if (value instanceof Date) return value.getTime();
  const text = String(value);
  return Date.parse(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
}

export function chooseDailyPrice(rows: DailyPriceCandidate[], cik: number, date: string, asOf: string): DailyPriceResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(asOf))) throw new Error("Invalid daily price date or asOf");
  const candidates = rows.filter((row) => row.cik === cik && row.date === date && (row.source === "schwab" || row.source === "stooq"));
  const validCloseCandidates = candidates.filter((row) => row.close !== null && Number.isFinite(row.close) && row.close > 0);
  const eligible = validCloseCandidates
    .filter((row) => timestamp(row.fetchedAt) <= Date.parse(asOf))
    .sort((a, b) => Number(b.source === "schwab") - Number(a.source === "schwab") || timestamp(b.fetchedAt) - timestamp(a.fetchedAt) || b.id - a.id);
  const status = validCloseCandidates.length ? "stale" : "missing";
  const base: DailyPriceResult = { status, cik, date, price: null, actualAsOf: null, currency: "USD", quality: status, source: null, fetchedAt: null, bar: null };
  const selected = eligible[0];
  if (!selected) return base;
  return {
    status: "ready",
    cik,
    date,
    price: selected.close,
    actualAsOf: selected.date,
    currency: "USD",
    quality: selected.source === "schwab" ? "official_close" : "historical_backfill",
    source: selected.source,
    fetchedAt: selected.fetchedAt,
    bar: selected,
  };
}

export async function dailyPrice(cik: number, date: string, asOf: string): Promise<DailyPriceResult> {
  const rows = await getDb().select({
    id: prices.id,
    cik: prices.cik,
    date: prices.date,
    open: prices.open,
    high: prices.high,
    low: prices.low,
    close: prices.close,
    adjClose: prices.adjClose,
    volume: prices.volume,
    source: prices.source,
    fetchedAt: prices.fetchedAt,
  }).from(prices).where(and(eq(prices.cik, cik), eq(prices.date, date), inArray(prices.source, ["schwab", "stooq"])));
  return chooseDailyPrice(rows, cik, date, asOf);
}
