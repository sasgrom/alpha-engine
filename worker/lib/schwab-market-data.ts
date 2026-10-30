import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeSchwabChain, schwabQa, type SchwabMarketSnapshot, type SchwabOptionRow } from "./schwab-normalize";

export interface SchwabManifestEntry {
  ticker: string;
  status: "complete" | "partial" | "failed";
  capturedAt: string;
  sourceHash: string;
  file: string;
  error?: string;
}
export interface SchwabManifest {
  schemaVersion: 1;
  tickers: SchwabManifestEntry[];
}
export function buildSchwabMarketSnapshot(params: {
  root: string;
  tickersExpected: number;
  manifest: SchwabManifest;
  generatedAt: string;
  tokenExpiresAt: string | null;
  lastRefreshAt: string | null;
}): SchwabMarketSnapshot {
  const { root, tickersExpected, manifest, generatedAt, tokenExpiresAt, lastRefreshAt } = params;
  const latestByTicker = new Map<string, SchwabManifestEntry>();
  for (const entry of manifest.tickers) {
    const previous = latestByTicker.get(entry.ticker);
    if (!previous || entry.capturedAt > previous.capturedAt) latestByTicker.set(entry.ticker, entry);
  }
  const entries = [...latestByTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const options: SchwabOptionRow[] = [];
  const files: SchwabMarketSnapshot["files"] = [];
  let errors = 0, completed = 0, latestCapture: string | null = null;
  for (const entry of entries) {
    const file: SchwabMarketSnapshot["files"][number] = {
      ticker: entry.ticker,
      file: entry.file,
      sourceHash: entry.sourceHash,
      status: entry.status,
      capturedAt: entry.capturedAt,
      ...(entry.error ? { error: entry.error } : {}),
    };
    if (entry.status !== "complete") {
      errors++;
      files.push(file);
      continue;
    }
    try {
      const raw = readFileSync(path.join(root, entry.file), "utf8");
      const normalized = normalizeSchwabChain(raw, entry.capturedAt);
      if (normalized.sourceHash !== entry.sourceHash) throw new Error("Source hash mismatch");
      if (normalized.sourceStatus !== "SUCCESS") throw new Error(`Provider status ${normalized.sourceStatus}`);
      if (normalized.chainTruncated) throw new Error("Provider reports a truncated chain");
      options.push(...normalized.rows);
      completed++;
      if (!latestCapture || entry.capturedAt > latestCapture) latestCapture = entry.capturedAt;
    } catch (error) {
      errors++;
      file.status = "failed";
      file.error = (error as { code?: string }).code
        ? "Raw chain file is unreadable"
        : error instanceof Error ? error.message.slice(0, 180) : "Raw chain normalization failed";
    }
    files.push(file);
  }
  options.sort((a, b) => a.underlying.localeCompare(b.underlying) || a.expiration.localeCompare(b.expiration) || a.strike - b.strike || a.putCall.localeCompare(b.putCall));
  const qa = schwabQa(options);
  const expirations = new Set(options.map((row) => row.expiration)).size;
  return {
    schemaVersion: 1,
    generatedAt,
    provider: "schwab",
    files,
    coverage: {
      tickersExpected,
      tickersCompleted: completed,
      endpointsComplete: completed * 4,
      errors,
      contracts: options.length,
      expirations,
      latestCapture,
      tokenExpiresAt,
      lastRefreshAt,
    },
    options,
    qa: { ...qa, manifestErrors: errors },
  };
}
