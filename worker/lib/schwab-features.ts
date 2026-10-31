import { dteBucket, type DteBucket } from "./option-features";
import { expectedMove } from "./expected-move";
import { sha256Text, type SchwabMarketSnapshot, type SchwabOptionRow } from "./schwab-normalize";

export interface SchwabFeatureBucket {
  bucket: DteBucket;
  dte: number | null;
  atmIv: number | null;
  expectedMove: number | null;
  expectedMovePct: number | null;
  termSlope: number | null;
  skew25: number | null;
  putCallVolumeRatio: number | null;
  putCallOiRatio: number | null;
  turnover: number | null;
  atmSpreadPct: number | null;
  zeroBidShare: number;
  zeroAskShare: number;
  volume: number;
  openInterest: number;
  contracts: number;
}
export interface SchwabTickerFeatures {
  ticker: string;
  capturedAt: string;
  snapshotCount: number;
  spot: number | null;
  rv20: number | null;
  ivRvspread: number | null;
  buckets: SchwabFeatureBucket[];
  warnings: string[];
}
export interface SchwabFeatureReport {
  schemaVersion: 1;
  generatedAt: string;
  provider: "schwab";
  sourceSnapshotSha256: string;
  coverage: { tickers: number; contracts: number; rv20Available: number };
  tickers: SchwabTickerFeatures[];
}
export interface SchwabPriceCandle { datetime: number; close: number }
const ORDER: DteBucket[] = ["0DTE", "1-7D", "8-30D", "31-90D", "91-365D", "365+D"];
const sum = (rows: SchwabOptionRow[], key: "volume" | "openInterest") => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
const ratio = (a: number, b: number) => b === 0 ? null : a / b;
const nearest = (rows: SchwabOptionRow[], spot: number, putCall: "CALL" | "PUT") => [...rows].filter((row) => row.putCall === putCall).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0] ?? null;
const nearestDelta = (rows: SchwabOptionRow[], putCall: "CALL" | "PUT", target: number) => [...rows].filter((row) => row.putCall === putCall && row.delta !== null).sort((a, b) => Math.abs((a.delta ?? 0) - target) - Math.abs((b.delta ?? 0) - target))[0] ?? null;
const atmIv = (rows: SchwabOptionRow[], spot: number | null): number | null => {
  if (spot === null) return null;
  const values = [nearest(rows, spot, "CALL"), nearest(rows, spot, "PUT")].map((row) => row?.iv).filter((value): value is number => value !== null && value > 0);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
};

export function rv20FromCandles(candles: SchwabPriceCandle[], capturedAt: string): number | null {
  const cutoff = Date.parse(`${capturedAt.slice(0, 10)}T00:00:00Z`);
  const bars = candles.filter((bar) => Number.isFinite(bar.datetime) && bar.datetime < cutoff && Number.isFinite(bar.close) && bar.close > 0).sort((a, b) => a.datetime - b.datetime).slice(-21);
  if (bars.length < 21) return null;
  const returns = bars.slice(1).map((bar, index) => Math.log(bar.close / bars[index].close));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252);
}

function bucketFeatures(rows: SchwabOptionRow[], spot: number | null): SchwabFeatureBucket[] {
  const groups = new Map<DteBucket, SchwabOptionRow[]>();
  for (const row of rows) {
    const bucket = dteBucket(row.dte);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(row);
  }
  const ivByBucket = new Map<DteBucket, number | null>(ORDER.map((bucket) => [bucket, atmIv(groups.get(bucket) ?? [], spot)]));
  return ORDER.filter((bucket) => groups.has(bucket)).map((bucket) => {
    const group = groups.get(bucket)!;
    const iv = ivByBucket.get(bucket)!;
    const dtes = group.map((row) => row.dte).sort((a, b) => a - b);
    const dte = dtes[Math.floor(dtes.length / 2)] ?? null;
    const move = spot !== null && iv !== null && dte !== null ? expectedMove(spot, iv, dte) : null;
    const next = ORDER.slice(ORDER.indexOf(bucket) + 1).map((candidate) => ivByBucket.get(candidate)).find((value) => value !== null && value !== undefined) ?? null;
    const call25 = nearestDelta(group, "CALL", 0.25), put25 = nearestDelta(group, "PUT", -0.25);
    const skew25 = call25?.iv != null && put25?.iv != null ? put25.iv - call25.iv : null;
    const calls = group.filter((row) => row.putCall === "CALL"), puts = group.filter((row) => row.putCall === "PUT");
    const callVolume = sum(calls, "volume"), putVolume = sum(puts, "volume");
    const callOi = sum(calls, "openInterest"), putOi = sum(puts, "openInterest");
    const atmRows = spot === null ? [] : [nearest(group, spot, "CALL"), nearest(group, spot, "PUT")].filter((row): row is SchwabOptionRow => row !== null);
    const spreads = atmRows.map((row) => row.bid !== null && row.ask !== null && row.bid + row.ask > 0 ? (row.ask - row.bid) / ((row.ask + row.bid) / 2) : null).filter((value): value is number => value !== null);
    return {
      bucket, dte, atmIv: iv,
      expectedMove: move,
      expectedMovePct: move !== null && spot !== null && spot > 0 ? move / spot : null,
      termSlope: iv !== null && next !== null ? next - iv : null,
      skew25,
      putCallVolumeRatio: ratio(putVolume, callVolume),
      putCallOiRatio: ratio(putOi, callOi),
      turnover: ratio(callVolume + putVolume, callOi + putOi),
      atmSpreadPct: spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null,
      zeroBidShare: group.filter((row) => row.bid === 0).length / group.length,
      zeroAskShare: group.filter((row) => row.ask === 0).length / group.length,
      volume: callVolume + putVolume,
      openInterest: callOi + putOi,
      contracts: group.length,
    };
  });
}

export function buildSchwabFeatureReport(params: {
  snapshot: SchwabMarketSnapshot;
  manifest: { tickers: { ticker: string }[] };
  prices: Record<string, SchwabPriceCandle[]>;
  generatedAt: string;
}): SchwabFeatureReport {
  const { snapshot, manifest, prices, generatedAt } = params;
  const capturedByTicker = new Map(snapshot.files.map((file) => [file.ticker, file.capturedAt]));
  const snapshotCounts = new Map<string, number>();
  for (const entry of manifest.tickers) snapshotCounts.set(entry.ticker, (snapshotCounts.get(entry.ticker) ?? 0) + 1);
  const rowsByTicker = new Map<string, SchwabOptionRow[]>();
  for (const row of snapshot.options) {
    if (!rowsByTicker.has(row.underlying)) rowsByTicker.set(row.underlying, []);
    rowsByTicker.get(row.underlying)!.push(row);
  }
  const tickers = [...rowsByTicker.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ticker, rows]) => {
    const capturedAt = capturedByTicker.get(ticker) ?? snapshot.coverage.latestCapture ?? snapshot.generatedAt;
    const spot = rows.find((row) => row.underlyingPrice !== null)?.underlyingPrice ?? null;
    const buckets = bucketFeatures(rows, spot);
    const rv20 = rv20FromCandles(prices[ticker] ?? [], capturedAt);
    const frontIv = buckets.find((bucket) => bucket.atmIv !== null)?.atmIv ?? null;
    const warnings: string[] = [];
    if (rv20 === null) warnings.push("RV20 unavailable: at least 21 completed daily closes are required.");
    if (buckets.some((bucket) => bucket.bucket === "0DTE")) warnings.push("0DTE expected move is null: an intraday time-to-close model is not assumed.");
    if (buckets.some((bucket) => bucket.skew25 === null)) warnings.push("Some buckets lack matched 25-delta call/put IV for skew.");
    return {
      ticker, capturedAt, snapshotCount: snapshotCounts.get(ticker) ?? 1, spot, rv20,
      ivRvspread: frontIv !== null && rv20 !== null ? frontIv - rv20 : null,
      buckets, warnings,
    };
  });
  return {
    schemaVersion: 1,
    generatedAt,
    provider: "schwab",
    sourceSnapshotSha256: sha256Text(JSON.stringify(snapshot)),
    coverage: { tickers: tickers.length, contracts: snapshot.options.length, rv20Available: tickers.filter((ticker) => ticker.rv20 !== null).length },
    tickers,
  };
}
