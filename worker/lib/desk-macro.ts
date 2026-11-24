/**
 * The Today page's macro card: the newest published value of a few FRED series, read from the macro archive's
 * normalized vintage files (worker/macro-fred-fetch.mts). The app's macro_points table is not read: nothing has
 * filled it since 2026-11-07.
 */

export const DESK_MACRO_SCHEMA_VERSION = 1;

/** The card's series, in display order. Units: pct = percent, index and level = plain numbers. */
export const DESK_MACRO_SERIES: { seriesId: string; label: string; unit: "pct" | "index" | "level" }[] = [
  { seriesId: "DGS10", label: "10Y Treasury yield", unit: "pct" },
  { seriesId: "DGS2", label: "2Y Treasury yield", unit: "pct" },
  { seriesId: "T10Y2Y", label: "Term spread 10Y−2Y", unit: "pct" },
  { seriesId: "FEDFUNDS", label: "Fed funds rate", unit: "pct" },
  { seriesId: "CPIAUCSL", label: "CPI index (YoY shown)", unit: "index" },
  { seriesId: "UNRATE", label: "Unemployment rate", unit: "pct" },
  { seriesId: "BAMLH0A0HYM2", label: "HY credit spread (OAS)", unit: "pct" },
  { seriesId: "VIXCLS", label: "VIX close", unit: "level" },
];

/** One vintage row of a normalized FRED file (only the fields used here). */
export interface MacroVintageRow {
  observationPeriod: string;
  value: number | null;
  availableAt: string | null;
  supersededAt: string | null;
}

export interface DeskMacroPoint {
  seriesId: string;
  label: string;
  unit: "pct" | "index" | "level";
  /** The period the value is for. */
  date: string;
  value: number;
  /** When FRED first showed this value. */
  availableAt: string | null;
}

export interface DeskMacroFile {
  schemaVersion: typeof DESK_MACRO_SCHEMA_VERSION;
  /** When the archive the values come from was written. */
  archiveGeneratedAt: string;
  builtAt: string;
  series: DeskMacroPoint[];
}

/**
 * The newest published value of a series: among the vintages still in force (not superseded) with a value, the one
 * for the latest period; two in-force vintages of one period resolve to the later publication.
 */
export function latestMacroVintage(rows: MacroVintageRow[]): MacroVintageRow | null {
  let best: MacroVintageRow | null = null;
  for (const row of rows) {
    if (row.supersededAt !== null || row.value === null || !Number.isFinite(row.value) || !/^\d{4}-\d{2}-\d{2}$/.test(row.observationPeriod)) continue;
    if (!best || row.observationPeriod > best.observationPeriod || (row.observationPeriod === best.observationPeriod && (row.availableAt ?? "") > (best.availableAt ?? ""))) best = row;
  }
  return best;
}

/** The card's file from each series' vintage rows. A series without a value in force is left out, never guessed. */
export function buildDeskMacro(params: { rowsBySeries: Map<string, MacroVintageRow[]>; archiveGeneratedAt: string; builtAt: string }): DeskMacroFile {
  const series: DeskMacroPoint[] = [];
  for (const definition of DESK_MACRO_SERIES) {
    const latest = latestMacroVintage(params.rowsBySeries.get(definition.seriesId) ?? []);
    if (latest) series.push({ ...definition, date: latest.observationPeriod, value: latest.value as number, availableAt: latest.availableAt });
  }
  return { schemaVersion: DESK_MACRO_SCHEMA_VERSION, archiveGeneratedAt: params.archiveGeneratedAt, builtAt: params.builtAt, series };
}
