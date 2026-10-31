/**
 * GDELT manual-export CSV parsers (plan B, 4p) — pure, unit-tested.
 *
 * Two export shapes from the DOC 2.1 API / Analysis Service are supported:
 *
 *  A) ArtList CSV (format=csv): header contains "seendate"; each row = one
 *     article. We aggregate to per-day BUZZ (article counts). Tone is not in
 *     this export — honestly absent, not fabricated.
 *     seendate comes as "YYYYMMDDHHMMSS" or ISO-ish — we take the first 8 digits.
 *
 *  B) Timeline CSV (TimelineTone / TimelineVol export): rows of
 *     "datetime,value". We average values per UTC day → TONE (TimelineTone)
 *     or relative VOLUME (TimelineVol). Tone is GDELT's native [-10..10],
 *     normalized by ÷10 and clamped, consistent with the live collector.
 */
import type { SignalRow } from "./ingest";

export interface CsvParse {
  kind: "artlist" | "timeline" | "unknown";
  rows: string[][];
}

/** Split CSV text into rows (quoted-field safe enough for GDELT exports). */
export function splitCsv(text: string): string[][] {
  const out: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) out.push(row);
  return out;
}

export function detectKind(rows: string[][]): CsvParse["kind"] {
  const header = (rows[0] ?? []).join(",").toLowerCase();
  if (header.includes("seendate") || header.includes("url")) return "artlist";
  if (header.includes("datetime") && header.includes("value")) return "timeline";
  // GDELT timeline CSV sometimes has no header: two columns, first date-ish
  const r0 = rows[0] ?? [];
  if (r0.length === 2 && /^\d{8}/.test(r0[0].replace(/\D/g, ""))) return "timeline";
  return "unknown";
}

const dayKey = (raw: string): string | null => {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const [y, m, d] = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)];
  if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return null;
  return `${y}${m}${d}`;
};
const dayEventTs = (key: string) => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)} 00:00:00`;

/** ArtList → per-day buzz rows. */
export function artlistToBuzz(cik: number, rows: string[][]): SignalRow[] {
  const header = (rows[0] ?? []).map((h) => h.toLowerCase());
  const iDate = Math.max(header.indexOf("seendate"), 0);
  const body = header.includes("seendate") ? rows.slice(1) : rows;
  const perDay = new Map<string, number>();
  for (const r of body) {
    const k = dayKey(r[iDate] ?? "");
    if (k) perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  return [...perDay.entries()].sort().map(([k, n]) => ({
    cik, source: "gdelt" as const, signalType: "buzz" as const,
    eventTs: dayEventTs(k), magnitude: n,
    payloadKey: `gdeltcsv:buzz:${cik}:${k}`, src: "backfill" as const,
  }));
}

/** Timeline → per-day tone rows (GDELT tone ÷10, clamped). Averaged unweighted. */
export function timelineToTone(cik: number, rows: string[][]): SignalRow[] {
  const body = (rows[0] ?? []).join(",").toLowerCase().includes("datetime") ? rows.slice(1) : rows;
  const perDay = new Map<string, { sum: number; n: number }>();
  for (const r of body) {
    const k = dayKey(r[0] ?? "");
    const v = Number(r[1]);
    if (!k || !Number.isFinite(v)) continue;
    const acc = perDay.get(k) ?? { sum: 0, n: 0 };
    acc.sum += v; acc.n++;
    perDay.set(k, acc);
  }
  return [...perDay.entries()].sort().map(([k, { sum, n }]) => {
    const clamped = Math.max(-1, Math.min(1, sum / n / 10));
    return {
      cik, source: "gdelt" as const, signalType: "tone" as const,
      eventTs: dayEventTs(k), score: Math.round(clamped * 1000) / 1000, magnitude: n,
      payloadKey: `gdeltcsv:tone:${cik}:${k}`, src: "backfill" as const,
    };
  });
}
