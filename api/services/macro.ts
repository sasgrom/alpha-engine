/**
 * Macro service (4m, D46) — the Stage 4 seed: FRED series collected through
 * the igo_open_data plugin (agent-gw — works from the sandbox and the home
 * machine; the prod container has no python, so collection is
 * sandbox/worker-side and this module owns parsing + storage + reads).
 *
 * Vintage discipline (D2 for macro): every point keeps FRED's realtime
 * window (realtimeStart/realtimeEnd) — a value is valid only inside it.
 *
 * v1 curated set (the regime pack):
 *   DGS10 10Y yield · DGS2 2Y · T10Y2Y term spread · FEDFUNDS · CPIAUCSL
 *   (CPI index; YoY computed) · UNRATE · BAMLH0A0HYM2 (HY OAS credit
 *   spread) · VIXCLS (VIX close).
 */
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { macroPoints } from "@db/schema";

export interface MacroSeriesDef {
  id: string;
  label: string;
  unit: "pct" | "index" | "level";
}

export const MACRO_SERIES: MacroSeriesDef[] = [
  { id: "DGS10", label: "10Y Treasury yield", unit: "pct" },
  { id: "DGS2", label: "2Y Treasury yield", unit: "pct" },
  { id: "T10Y2Y", label: "Term spread 10Y−2Y", unit: "pct" },
  { id: "FEDFUNDS", label: "Fed funds rate", unit: "pct" },
  { id: "CPIAUCSL", label: "CPI index (YoY shown)", unit: "index" },
  { id: "UNRATE", label: "Unemployment rate", unit: "pct" },
  { id: "BAMLH0A0HYM2", label: "HY credit spread (OAS)", unit: "pct" },
  { id: "VIXCLS", label: "VIX close", unit: "level" },
];

/** Parse the plugin CSV (date,realtime_start,realtime_end,value) — FRED's "." → null. */
export function parseFredCsv(csvText: string): { date: string; value: number | null; realtimeStart: string | null; realtimeEnd: string | null }[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const [date, re, rs, value] = line.split(",");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      date,
      realtimeEnd: re && /^\d{4}-\d{2}-\d{2}$/.test(re) ? re : null,
      realtimeStart: rs && /^\d{4}-\d{2}-\d{2}$/.test(rs) ? rs : null,
      value: value === undefined || value === "" || value === "." ? null : Number(value),
    });
  }
  return out;
}

/** Ingest parsed points (idempotent via the UQ key; chunked ≤500). */
export async function ingestMacroPoints(
  seriesId: string,
  points: ReturnType<typeof parseFredCsv>
): Promise<number> {
  const db = getDb();
  let n = 0;
  const CHUNK = 500;
  for (let i = 0; i < points.length; i += CHUNK) {
    const slice = points.slice(i, i + CHUNK);
    await db
      .insert(macroPoints)
      .values(slice.map((p) => ({ seriesId, date: p.date, value: p.value, realtimeStart: p.realtimeStart, realtimeEnd: p.realtimeEnd })))
      .onDuplicateKeyUpdate({ set: { value: sql`VALUES(\`value\`)`, realtimeEnd: sql`VALUES(\`realtimeEnd\`)` } });
    n += slice.length;
  }
  return n;
}

/** Latest value per series for the dashboard card (Stage 4 seed). */
export async function latestMacro(): Promise<{ seriesId: string; label: string; unit: string; date: string; value: number | null }[]> {
  const db = getDb();
  const out = [];
  for (const s of MACRO_SERIES) {
    const [row] = await db
      .select()
      .from(macroPoints)
      .where(eq(macroPoints.seriesId, s.id))
      .orderBy(desc(macroPoints.date))
      .limit(1);
    if (row) out.push({ seriesId: s.id, label: s.label, unit: s.unit, date: row.date, value: row.value });
  }
  return out;
}
