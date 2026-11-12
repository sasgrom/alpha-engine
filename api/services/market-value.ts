import { and, eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { companies, prices } from "@db/schema";
import { getDb } from "../queries/connection";
import { mergeBars, type StoredBar } from "./prices";
import {
  createSplitShareProvider,
  hasShareCandidate,
  type ShareEvidence,
  type SplitProfile,
} from "./split-shares";

export interface ShareProvider {
  at(date: string): ShareEvidence | null;
  profile?: SplitProfile;
}

export interface SchwabInstrumentContext {
  generatedAt: string;
  capturedAt?: string;
  instruments: { symbol: string; fundamental: { sharesOutstanding: number } }[];
  files?: { kind: string; sourceHash: string }[];
}

export interface MarketValueEvidence {
  marketCap: number | null;
  price: number | null;
  priceDate: string | null;
  priceSource: string | null;
  shares: ShareEvidence | null;
}

export async function getSchwabLevelBars(
  cik: number,
  from?: string,
  to?: string
): Promise<StoredBar[]> {
  const db = getDb();
  const series: StoredBar[][] = [];
  for (const source of ["schwab-hist", "schwab"] as const) {
    const conditions = [eq(prices.cik, cik), eq(prices.source, source)];
    if (from) conditions.push(sql`${prices.date} >= ${from}`);
    if (to) conditions.push(sql`${prices.date} <= ${to}`);
    const rows = await db
      .select()
      .from(prices)
      .where(and(...conditions))
      .orderBy(prices.date)
      .limit(15000);
    series.push(
      rows.map(row => ({
        date: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        adjClose: row.adjClose,
        volume: row.volume,
        source: row.source,
      }))
    );
  }
  return mergeBars(series[1], series[0]);
}

async function instrumentShareFallback(
  cik: number,
  context?: SchwabInstrumentContext
): Promise<ShareEvidence | null> {
  const [company] = await getDb()
    .select({ ticker: companies.ticker })
    .from(companies)
    .where(eq(companies.cik, cik))
    .limit(1);
  if (!company) return null;
  const resolved =
    context ??
    (JSON.parse(
      readFileSync(path.resolve("public/reports/schwab-context.json"), "utf8")
    ) as SchwabInstrumentContext);
  const instrument = resolved.instruments.find(
    row => row.symbol === company.ticker
  );
  const shares = Number(instrument?.fundamental.sharesOutstanding);
  if (!instrument || !Number.isFinite(shares) || shares <= 0) return null;
  const capturedAt = resolved.capturedAt ?? resolved.generatedAt;
  if (!Number.isFinite(Date.parse(capturedAt))) return null;
  return {
    shares,
    rawShares: shares,
    ratio: 1,
    source: "schwab_instrument",
    periodEnd: capturedAt.slice(0, 10),
    filed: capturedAt,
    accession: `schwab instrument/${company.ticker}`,
    sourceHash:
      resolved.files?.find(file => file.kind === `instrument/${company.ticker}`)
        ?.sourceHash ?? null,
    events: [],
  };
}

export async function getMarketValueAt(
  cik: number,
  date: string,
  provider?: ShareProvider,
  bars?: StoredBar[],
  instrumentContext?: SchwabInstrumentContext
): Promise<MarketValueEvidence> {
  const [shareProvider, levelBars] = await Promise.all([
    provider ? Promise.resolve(provider) : createSplitShareProvider(cik),
    bars ? Promise.resolve(bars) : getSchwabLevelBars(cik, undefined, date),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const allowFallback =
    date === today &&
    ((shareProvider.profile &&
      !hasShareCandidate(shareProvider.profile, date)) ||
      (!shareProvider.profile && instrumentContext !== undefined));
  const shares =
    shareProvider.at(date) ??
    (allowFallback
      ? await instrumentShareFallback(cik, instrumentContext)
      : null);
  const eligible = levelBars.filter(
    bar =>
      bar.date <= date &&
      bar.close !== null &&
      Number.isFinite(bar.close) &&
      bar.close > 0
  );
  const latest = eligible[eligible.length - 1] ?? null;
  const price = latest?.close ?? null;
  return {
    marketCap: shares !== null && price !== null ? shares.shares * price : null,
    price,
    priceDate: latest?.date ?? null,
    priceSource: latest?.source ?? null,
    shares,
  };
}

export async function getCurrentMarketValue(
  cik: number,
  provider?: ShareProvider,
  bars?: StoredBar[],
  instrumentContext?: SchwabInstrumentContext
): Promise<MarketValueEvidence> {
  return getMarketValueAt(
    cik,
    new Date().toISOString().slice(0, 10),
    provider,
    bars,
    instrumentContext
  );
}
