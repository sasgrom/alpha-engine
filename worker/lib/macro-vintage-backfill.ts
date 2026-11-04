export const CURATED_MACRO_SERIES = ["DGS10", "DGS2", "T10Y2Y", "FEDFUNDS", "CPIAUCSL", "UNRATE", "BAMLH0A0HYM2", "VIXCLS"] as const;

export function parseMacroSeriesList(requested: string | null): string[] {
  const parts = requested === null ? [...CURATED_MACRO_SERIES] : requested.split(",").map((value) => value.trim().toUpperCase());
  if (parts.some((value) => !value)) throw new Error("Series list contains an empty series ID");
  if (new Set(parts).size !== parts.length) throw new Error("Series list contains a duplicate series ID");
  for (const seriesId of parts) if (!CURATED_MACRO_SERIES.includes(seriesId as (typeof CURATED_MACRO_SERIES)[number])) throw new Error(`Unsupported curated series ${seriesId}`);
  return parts;
}

export interface NormalizedMacroVintageRow {
  seriesId: string;
  observationPeriod: string;
  value: number | null;
  availableAt: string | null;
  supersededAt: string | null;
  ingestedAt?: string;
  researchEligibleAt?: string;
  sourceHash: string;
}
export interface ExistingMacroVintageRow {
  id?: number;
  seriesId: string;
  date: string;
  value: number | null;
  realtimeStart: string | null;
  realtimeEnd: string | null;
}
export interface MacroVintageIngestPoint {
  date: string;
  value: number | null;
  realtimeStart: string;
  realtimeEnd: string | null;
  fetchedAt: string;
}
export interface MacroVintageBackfillPlan {
  seriesId: string;
  inputRows: number;
  points: MacroVintageIngestPoint[];
  missingAvailability: { observationPeriod: string; reason: "missing_availableAt" }[];
  duplicateArchiveRows: number;
  unchangedExistingRows: number;
  fetchedAt: string;
}
export interface MacroVintageConflict {
  key: string;
  source: "archive" | "database";
  existing: { value: number | null; realtimeEnd: string | null };
  candidate: { value: number | null; realtimeEnd: string | null };
}

export class MacroVintageConflictError extends Error {
  readonly conflicts: MacroVintageConflict[];

  constructor(conflicts: MacroVintageConflict[]) {
    super(`Conflicting macro vintage keys: ${conflicts.map((conflict) => conflict.key).join(", ")}`);
    this.name = "MacroVintageConflictError";
    this.conflicts = conflicts;
  }
}

function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function availabilityDay(value: string, field: string): string {
  const day = value.slice(0, 10);
  if (!validDay(day) || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${field}: ${value}`);
  return day;
}
const keyOf = (seriesId: string, date: string, start: string) => `${seriesId}|${date}|${start}`;

export function prepareMacroVintageBackfill(
  seriesId: string,
  archiveRows: readonly NormalizedMacroVintageRow[],
  existingRows: readonly ExistingMacroVintageRow[],
  fetchedAt: string,
): MacroVintageBackfillPlan {
  if (!CURATED_MACRO_SERIES.includes(seriesId as (typeof CURATED_MACRO_SERIES)[number])) throw new Error(`Unsupported curated macro series ${seriesId}`);
  if (!Number.isFinite(Date.parse(fetchedAt))) throw new Error("A valid new ingest timestamp is required");
  const candidates = new Map<string, MacroVintageIngestPoint>();
  const missingAvailability: MacroVintageBackfillPlan["missingAvailability"] = [];
  const conflicts: MacroVintageConflict[] = [];
  let duplicateArchiveRows = 0;
  for (const row of archiveRows) {
    if (row.seriesId !== seriesId) throw new Error(`Archive series mismatch: expected ${seriesId}, got ${row.seriesId}`);
    if (!validDay(row.observationPeriod)) throw new Error(`Invalid observationPeriod for ${seriesId}`);
    if (row.value !== null && (typeof row.value !== "number" || !Number.isFinite(row.value))) throw new Error(`Invalid value for ${seriesId}|${row.observationPeriod}`);
    // Only official availability defines realtimeStart. Ingest and research timestamps never substitute for it.
    if (!row.availableAt) {
      missingAvailability.push({ observationPeriod: row.observationPeriod, reason: "missing_availableAt" });
      continue;
    }
    if (row.supersededAt === undefined) throw new Error(`Missing supersededAt field for ${seriesId}|${row.observationPeriod}`);
    const point: MacroVintageIngestPoint = {
      date: row.observationPeriod,
      value: row.value,
      realtimeStart: availabilityDay(row.availableAt, "availableAt"),
      realtimeEnd: row.supersededAt === null ? null : availabilityDay(row.supersededAt, "supersededAt"),
      fetchedAt,
    };
    if (point.realtimeEnd !== null && point.realtimeStart > point.realtimeEnd) throw new Error(`Availability inversion for ${seriesId}|${point.date}|${point.realtimeStart}`);
    const key = keyOf(seriesId, point.date, point.realtimeStart);
    const prior = candidates.get(key);
    if (prior) {
      if (prior.value !== point.value || prior.realtimeEnd !== point.realtimeEnd) {
        conflicts.push({ key, source: "archive", existing: { value: prior.value, realtimeEnd: prior.realtimeEnd }, candidate: { value: point.value, realtimeEnd: point.realtimeEnd } });
      } else {
        duplicateArchiveRows++;
      }
      continue;
    }
    candidates.set(key, point);
  }
  const points: MacroVintageIngestPoint[] = [];
  let unchangedExistingRows = 0;
  for (const [key, point] of candidates) {
    const existing = existingRows.filter((row) => row.seriesId === seriesId && row.date === point.date && row.realtimeStart === point.realtimeStart);
    // Identical keys with different values or ends are conflicts, never an upsert/deduplication opportunity.
    for (const row of existing) {
      if (row.value !== point.value || row.realtimeEnd !== point.realtimeEnd) {
        conflicts.push({ key, source: "database", existing: { value: row.value, realtimeEnd: row.realtimeEnd }, candidate: { value: point.value, realtimeEnd: point.realtimeEnd } });
      }
    }
    if (existing.length) unchangedExistingRows++;
    else points.push(point);
  }
  if (conflicts.length) throw new MacroVintageConflictError(conflicts);
  return { seriesId, inputRows: archiveRows.length, points, missingAvailability, duplicateArchiveRows, unchangedExistingRows, fetchedAt };
}

export async function backfillMacroVintageSeries(
  plan: MacroVintageBackfillPlan,
  ingest: (seriesId: string, points: MacroVintageIngestPoint[]) => Promise<number>,
): Promise<{ seriesId: string; status: "complete"; insertedRows: number; duplicateArchiveRows: number; unchangedExistingRows: number; missingAvailability: number }> {
  const insertedRows = plan.points.length ? await ingest(plan.seriesId, plan.points) : 0;
  if (insertedRows !== plan.points.length) throw new Error(`Ingest count mismatch for ${plan.seriesId}: expected ${plan.points.length}, got ${insertedRows}`);
  return {
    seriesId: plan.seriesId,
    status: "complete",
    insertedRows,
    duplicateArchiveRows: plan.duplicateArchiveRows,
    unchangedExistingRows: plan.unchangedExistingRows,
    missingAvailability: plan.missingAvailability.length,
  };
}
