import type { DeskIntradayBar, DeskIntradayMarket, DeskIntradayPoint, DeskIntradaySeries } from "../../contracts/intraday";
import { SECTOR_NAME_BY_FUND } from "../../contracts/intraday";
import type { IntradayBar } from "./schwab-intraday";

export interface StoredIntradaySession {
  session: string;
  updatedAt: string;
  bars: Record<string, IntradayBar[]>;
  previousClose: Record<string, number | null>;
  delayed: Record<string, boolean | null>;
}

export interface PriceAdjustment {
  ticker: string;
  ratio: number;
  firstNewBasisDate: string;
}

export function easternDay(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function etWallToIso(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
  let candidate = target;
  for (let iteration = 0; iteration < 2; iteration++) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(candidate));
    const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
    const represented = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    candidate = target - (represented - candidate);
  }
  return new Date(candidate).toISOString();
}

export function intradayMarketOpen(session: string, capturedAt: string, now = new Date()): boolean {
  const captured = Date.parse(capturedAt), age = now.getTime() - captured;
  return Number.isFinite(captured) && easternDay(now) === session && age >= -60_000 && age <= 10 * 60_000;
}

export function intradaySymbol(ticker: string): string {
  return ticker.replace(/[-.]/g, "/");
}

export function rebaseIntradayBars(bars: IntradayBar[], previousClose: number | null, session: string, adjustments: PriceAdjustment[]): { bars: IntradayBar[]; previousClose: number | null; splitAdjusted: boolean } {
  const applicable = adjustments.filter(event => event.firstNewBasisDate > session && event.ratio > 0 && Number.isFinite(event.ratio));
  if (!applicable.length) return { bars, previousClose, splitAdjusted: false };
  const ratio = applicable.reduce((product, event) => product * event.ratio, 1);
  return {
    bars: bars.map(bar => ({ ...bar, o: bar.o * ratio, h: bar.h * ratio, l: bar.l * ratio, c: bar.c * ratio, v: bar.v === null ? null : bar.v / ratio })),
    previousClose: previousClose === null ? null : previousClose * ratio,
    splitAdjusted: true,
  };
}

export function withIntradayVwap(bars: IntradayBar[]): DeskIntradayBar[] {
  let turnover = 0, volume = 0;
  return bars.map(bar => {
    if (bar.v !== null && bar.v > 0) {
      turnover += ((bar.h + bar.l + bar.c) / 3) * bar.v;
      volume += bar.v;
    }
    return { ...bar, vwap: volume > 0 ? turnover / volume : null };
  });
}

export function prepareIntradaySeries(stored: StoredIntradaySession, ticker: string, adjustments: PriceAdjustment[] = []): DeskIntradaySeries {
  const symbol = intradaySymbol(ticker);
  const rawBars = stored.bars[symbol] ?? stored.bars[ticker] ?? [];
  const rebased = rebaseIntradayBars(rawBars, stored.previousClose[symbol] ?? stored.previousClose[ticker] ?? null, stored.session, adjustments.filter(event => intradaySymbol(event.ticker) === symbol));
  const bars = withIntradayVwap(rebased.bars);
  const vwap = bars.map(bar => bar.vwap).filter(value => value !== null).at(-1) ?? null;
  const open = bars[0]?.o ?? null;
  return {
    bars,
    previousClose: rebased.previousClose,
    vwap,
    openGap: open !== null && rebased.previousClose !== null && rebased.previousClose > 0 ? open / rebased.previousClose - 1 : null,
    delayed: stored.delayed[symbol] ?? stored.delayed[ticker] ?? null,
    splitAdjusted: rebased.splitAdjusted,
  };
}

export function intradayReturnPath(series: DeskIntradaySeries): DeskIntradayPoint[] {
  if (series.previousClose === null || series.previousClose <= 0) return [];
  return series.bars.map(bar => ({ time: bar.end, value: bar.c / series.previousClose! - 1 }));
}

function marketSeries(points: DeskIntradayPoint[]) {
  return { points, change: points.at(-1)?.value ?? null };
}

export function buildIntradayMarket(stored: StoredIntradaySession, companies: { ticker: string; name: string }[], now = new Date()): DeskIntradayMarket {
  const paths: Record<string, DeskIntradayPoint[]> = {};
  const companyReturns = new Map<string, DeskIntradayPoint[]>();
  const delayedValues: (boolean | null)[] = [];
  for (const company of companies) {
    const series = prepareIntradaySeries(stored, company.ticker);
    const path = intradayReturnPath(series);
    paths[company.ticker] = path;
    if (path.length) companyReturns.set(company.ticker, path);
    delayedValues.push(series.delayed);
  }
  for (const ticker of ["SPY", ...Object.keys(SECTOR_NAME_BY_FUND)]) {
    const series = prepareIntradaySeries(stored, ticker);
    paths[ticker] = intradayReturnPath(series);
    delayedValues.push(series.delayed);
  }
  const times = [...new Set([...companyReturns.values()].flatMap(path => path.map(point => point.time)))].sort();
  const breadth: DeskIntradayMarket["breadth"] = [], equalWeightPoints: DeskIntradayPoint[] = [];
  for (const time of times) {
    const values = [...companyReturns.values()].flatMap(path => {
      const point = path.find(row => row.time === time);
      return point ? [point.value] : [];
    });
    const above = values.filter(value => value > 0).length;
    breadth.push({ time, above, measured: values.length, share: values.length ? above / values.length : null });
    if (values.length) equalWeightPoints.push({ time, value: values.reduce((sum, value) => sum + value, 0) / values.length });
  }
  const movers = companies.flatMap(company => {
    const points = companyReturns.get(company.ticker) ?? [];
    return points.length ? [{ ticker: company.ticker, name: company.name, ...marketSeries(points) }] : [];
  }).sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0) || a.ticker.localeCompare(b.ticker)).slice(0, 6);
  const measured = companyReturns.size;
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    session: stored.session,
    asOf: stored.updatedAt,
    marketOpen: intradayMarketOpen(stored.session, stored.updatedAt, now),
    delayed: delayedValues.includes(true) ? true : delayedValues.includes(null) ? null : false,
    status: measured === companies.length && companies.length > 0 ? "ok" : "partial",
    coverage: { expected: companies.length, measured },
    breadth,
    spy: marketSeries(paths.SPY ?? []),
    equalWeight: marketSeries(equalWeightPoints),
    sectors: Object.entries(SECTOR_NAME_BY_FUND).map(([ticker, name]) => ({ ticker, name, ...marketSeries(paths[ticker] ?? []) })),
    movers,
    paths,
  };
}
