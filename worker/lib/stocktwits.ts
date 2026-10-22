/**
 * Stocktwits public stream normalizer (pure, unit-tested).
 *
 * Upstream: GET /api/2/streams/symbol/<TICKER>.json → messages[] with
 * id, created_at ("YYYY-MM-DDTHH:MM:SSZ") and optional entities.sentiment.basic
 * ("Bullish" | "Bearish").
 *
 * Aggregation per run: buzz magnitude = message count; label score =
 * (bullish - bearish) / labeled, clamped to [-1, 1] by construction.
 * payloadKey carries the NEWEST message id + count: a rerun with no new
 * messages reproduces the identical key → INSERT IGNORE dedupes it for free.
 */
import type { SignalRow } from "./ingest";

export interface StMessage {
  id: number | string;
  created_at: string;
  entities?: { sentiment?: { basic?: string | null } | null } | null;
}

export interface StAggregate {
  total: number;
  bullish: number;
  bearish: number;
  score: number | null; // null when nothing labeled
  newestId: string | null;
  newestTs: string | null; // "YYYY-MM-DD HH:MM:SS" UTC
}

export function aggregateStream(messages: StMessage[]): StAggregate {
  let bullish = 0, bearish = 0, newestId: string | null = null, newestTs: string | null = null;
  let newestIdNum = -1;
  for (const m of messages ?? []) {
    const s = m?.entities?.sentiment?.basic;
    if (s === "Bullish") bullish++;
    else if (s === "Bearish") bearish++;
    const idNum = Number(m.id);
    if (Number.isFinite(idNum) && idNum > newestIdNum) {
      newestIdNum = idNum;
      newestId = String(m.id);
      newestTs = m.created_at.replace("T", " ").replace("Z", "");
    }
  }
  const labeled = bullish + bearish;
  const score = labeled === 0 ? null : Math.round(((bullish - bearish) / labeled) * 1000) / 1000;
  return { total: (messages ?? []).length, bullish, bearish, score, newestId, newestTs };
}

/** Build rows for one company from its stream aggregate. Empty stream → []. */
export function buildStocktwitsRows(cik: number, agg: StAggregate): SignalRow[] {
  if (agg.total === 0 || !agg.newestTs || !agg.newestId) return [];
  const keySuffix = `${agg.newestId}:${agg.total}`;
  const rows: SignalRow[] = [
    {
      cik, source: "stocktwits", signalType: "buzz", eventTs: agg.newestTs,
      magnitude: agg.total, payloadKey: `st:buzz:${cik}:${keySuffix}`, src: "live",
    },
  ];
  if (agg.score !== null) {
    rows.push({
      cik, source: "stocktwits", signalType: "label", eventTs: agg.newestTs,
      score: agg.score, magnitude: agg.bullish + agg.bearish,
      payloadKey: `st:label:${cik}:${keySuffix}`, src: "live",
    });
  }
  return rows;
}
