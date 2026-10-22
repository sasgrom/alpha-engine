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
  body?: string;
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

// ---------------------------------------------------------------------------
// 5d — LLM crowd read (owner's idea): the same 30-message stream gets a local
// model verdict — WHAT the crowd discusses (why) + mood score that INCLUDES
// the unlabeled majority (the deterministic label row covers only self-taggers).
// Provenance stays separate: llm:<model>:stocktwits:… keys never mix with
// human-label rows; blending happens at digest time, not in the store.
// ---------------------------------------------------------------------------

/** Prompt for one company's stream dump. Messages truncated, numbered. */
export function crowdPrompt(ticker: string, messages: StMessage[]): string {
  const dump = messages
    .slice(0, 30)
    .map((m, i) => `${i + 1}. ${(m.body ?? "").replace(/\s+/g, " ").slice(0, 280)}`)
    .filter((l) => l.length > 4)
    .join("\n");
  return `You are reading the latest Stocktwits messages about $${ticker}. Rate the crowd's mood and summarize what they are talking about.

Reply with ONLY a JSON object, no other text:
{"score": <number from -1.0 to 1.0, the crowd's mood>, "why": "<3-4 short sentences for a human: the main topics, notable claims, and the mood driver>"}
-1.0 = panic/very bearish, 0 = mixed or idle chatter, +1.0 = euphoria/very bullish.
Read ALL messages, including unlabeled ones. Start "why" with the topic itself — never "The messages", "The posts".

MESSAGES:
"""
${dump.slice(0, 12000)}
"""`;
}

/** The LLM row for a stream (caller fills score/note from the model verdict). */
export function buildCrowdRow(cik: number, agg: StAggregate, model: string, score: number, note: string | null): SignalRow | null {
  if (!agg.newestTs || !agg.newestId) return null;
  return {
    cik, source: "stocktwits", signalType: "tone", eventTs: agg.newestTs,
    score, magnitude: agg.total, note,
    payloadKey: `llm:${model}:stocktwits:${cik}:${agg.newestId}`, src: "live",
  };
}
