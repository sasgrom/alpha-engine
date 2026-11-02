import { createHash } from "node:crypto";

export interface FredObservation {
  realtime_start: string;
  realtime_end: string;
  date: string;
  value: string;
}
export interface FredSeriesMetadata {
  id: string;
  title: string;
  frequency: string;
  units: string;
  seasonal_adjustment: string;
  last_updated: string;
  notes?: string;
}
export interface NormalizedMacroPoint {
  seriesId: string;
  observationPeriod: string;
  value: number | null;
  unit: string;
  frequency: string;
  releasedAt: null;
  availableAt: string;
  availablePrecision: "day";
  availabilityBasis: "fred_realtime_start";
  researchEligibleAt: string;
  vintageId: string;
  supersededAt: string | null;
  ingestedAt: string;
  sourceUrl: string;
  sourceHash: string;
}

export const sha256Text = (text: string) => createHash("sha256").update(text).digest("hex");
export const fredSeriesUrl = (seriesId: string) => `https://fred.stlouisfed.org/series/${seriesId}`;
export const endOfUtcDay = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) throw new Error(`Invalid FRED date ${date}`);
  return `${date}T23:59:59.999Z`;
};
export function redactFredSecrets(value: string, apiKey: string): string {
  return value.split(apiKey).join("[redacted]").replace(/api_key=[^&\s]+/gi, "api_key=[redacted]");
}

export async function fetchFredText(endpoint: "series" | "series/observations" | "series/vintagedates", params: Record<string, string>, apiKey: string): Promise<string> {
  const query = new URLSearchParams({ ...params, api_key: apiKey, file_type: "json" });
  const url = `https://api.stlouisfed.org/fred/${endpoint}?${query}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { "user-agent": "AlphaEngineMacro/1.0" } });
  const text = await response.text();
  if (!response.ok) throw new Error(redactFredSecrets(`FRED HTTP ${response.status}: ${text.slice(0, 300)}`, apiKey));
  return text;
}

export function normalizeFredObservations(
  seriesId: string,
  observations: FredObservation[],
  metadata: FredSeriesMetadata,
  sourceHash: string,
  ingestedAt: string,
): NormalizedMacroPoint[] {
  const rows = observations.map((observation) => {
    const numeric = observation.value === "." ? null : Number(observation.value);
    return {
      seriesId,
      observationPeriod: observation.date,
      value: numeric !== null && Number.isFinite(numeric) ? numeric : null,
      unit: metadata.units,
      frequency: metadata.frequency,
      releasedAt: null,
      availableAt: `${observation.realtime_start}T00:00:00.000Z`,
      availablePrecision: "day" as const,
      availabilityBasis: "fred_realtime_start" as const,
      researchEligibleAt: endOfUtcDay(observation.realtime_start),
      vintageId: `${seriesId}|${observation.date}|${observation.realtime_start}`,
      supersededAt: observation.realtime_end === "9999-12-31" ? null : endOfUtcDay(observation.realtime_end),
      ingestedAt,
      sourceUrl: fredSeriesUrl(seriesId),
      sourceHash,
    };
  });
  const unique = new Set<string>();
  for (const row of rows) {
    if (unique.has(row.vintageId)) throw new Error(`Duplicate FRED vintage ${row.vintageId}`);
    unique.add(row.vintageId);
    if (row.availableAt > row.ingestedAt) throw new Error(`FRED availability is after ingestion for ${row.vintageId}`);
    if (row.researchEligibleAt < row.availableAt) throw new Error(`Invalid research availability for ${row.vintageId}`);
  }
  return rows.sort((a, b) => a.observationPeriod.localeCompare(b.observationPeriod) || a.availableAt.localeCompare(b.availableAt));
}
