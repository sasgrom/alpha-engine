/**
 * GDELT DOC 2.1 normalizers (pure, unit-tested).
 *
 * Two upstream shapes are consumed:
 *  - ArtList (format=json): article list, we only count them → buzz magnitude.
 *    Saturates at maxrecords (250) — the honest cap is kept in the row.
 *  - ToneChart (format=json): tone histogram bins {bin, count}; we compute the
 *    weighted average tone and clamp to the signals contract [-1..1] — GDELT
 *    tone is roughly [-10..10], so we divide by 10 (documented approximation).
 */
import type { SignalRow } from "./ingest";

export interface ToneBin { bin: number | string; count: number | string }

/** Weighted average of a tone histogram, normalized to [-1, 1]. */
export function toneFromBins(bins: ToneBin[]): { score: number | null; articles: number } {
  let sum = 0, n = 0;
  for (const b of bins ?? []) {
    const bin = Number(b.bin), count = Number(b.count);
    if (!Number.isFinite(bin) || !Number.isFinite(count) || count <= 0) continue;
    sum += bin * count;
    n += count;
  }
  if (n === 0) return { score: null, articles: 0 };
  const avg = sum / n;
  const clamped = Math.max(-1, Math.min(1, avg / 10));
  return { score: Math.round(clamped * 1000) / 1000, articles: n };
}

/** Day bucket "YYYY-MM-DD 00:00:00" (UTC) + payloadKey fragment — backfill granularity. */
export function dayBucket(d: Date): { eventTs: string; key: string } {
  const y = d.getUTCFullYear();
  const p = (x: number) => String(x).padStart(2, "0");
  const key = `${y}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  return { eventTs: `${y}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} 00:00:00`, key };
}

/** Hour bucket "YYYY-MM-DD HH:00:00" (UTC) + its payloadKey fragment. */
export function hourBucket(d = new Date()): { eventTs: string; key: string } {
  const y = d.getUTCFullYear();
  const p = (x: number) => String(x).padStart(2, "0");
  const key = `${y}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
  return { eventTs: `${y}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:00:00`, key };
}

/** Count articles from an ArtList response (defensive about shape). */
export function countArticles(artlist: unknown): number {
  const arts = (artlist as any)?.articles;
  return Array.isArray(arts) ? arts.length : 0;
}

/** Build the two rows (tone + buzz) for one company-bucket. src marks live vs backfill. */
export function buildGdeltRows(
  cik: number,
  bucket: { eventTs: string; key: string },
  toneBins: ToneBin[],
  artlist: unknown,
  src: "live" | "backfill" = "live"
): SignalRow[] {
  const { score, articles } = toneFromBins(toneBins);
  const listed = countArticles(artlist);
  const buzzCount = Math.max(articles, listed); // histogram total is the honest volume when present
  const rows: SignalRow[] = [
    {
      cik, source: "gdelt", signalType: "buzz", eventTs: bucket.eventTs,
      magnitude: buzzCount, payloadKey: `gdelt:buzz:${cik}:${bucket.key}`, src,
    },
  ];
  if (score !== null) {
    rows.push({
      cik, source: "gdelt", signalType: "tone", eventTs: bucket.eventTs,
      score, magnitude: articles, payloadKey: `gdelt:tone:${cik}:${bucket.key}`, src,
    });
  }
  return rows;
}
