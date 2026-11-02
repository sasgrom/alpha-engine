import { existsSync, readFileSync } from "node:fs";
import { sha256Text } from "./fred";
import type { NormalizedMacroPoint } from "./fred";
import type { PoliticalEvent } from "./political-events";

export interface ManifestQaIssue { severity: "error" | "warning"; code: string; detail: string }
export interface ManifestQaResult { status: "pass" | "warn" | "fail"; errors: number; warnings: number; issues: ManifestQaIssue[] }

export function auditNormalizedMacroSeries(seriesId: string, rows: NormalizedMacroPoint[], expectedRows: number): ManifestQaIssue[] {
  const issues: ManifestQaIssue[] = [];
  if (rows.length !== expectedRows) issues.push({ severity: "error", code: "row_count", detail: `${seriesId}: manifest expects ${expectedRows}, normalized has ${rows.length}` });
  const unique = new Set<string>();
  for (const row of rows) {
    if (unique.has(row.vintageId)) issues.push({ severity: "error", code: "duplicate_vintage", detail: `${seriesId}: duplicate ${row.vintageId}` });
    unique.add(row.vintageId);
    if (row.observationPeriod < "2000-01-01") issues.push({ severity: "error", code: "pre2000", detail: `${seriesId}: ${row.observationPeriod}` });
    if (row.availableAt > row.ingestedAt) issues.push({ severity: "error", code: "availability_after_ingestion", detail: `${seriesId}: ${row.vintageId}` });
    if (row.researchEligibleAt < row.availableAt) issues.push({ severity: "error", code: "research_availability_inversion", detail: `${seriesId}: ${row.vintageId}` });
    if (row.supersededAt && row.supersededAt < row.availableAt) issues.push({ severity: "error", code: "superseded_before_available", detail: `${seriesId}: ${row.vintageId}` });
  }
  return issues;
}

export function auditMacroEvents(events: PoliticalEvent[]): ManifestQaIssue[] {
  const issues: ManifestQaIssue[] = [];
  const unique = new Set<string>();
  for (const event of events) {
    if (unique.has(event.eventId)) issues.push({ severity: "error", code: "duplicate_event", detail: event.eventId });
    unique.add(event.eventId);
    if (event.publishedAt > event.ingestedAt) issues.push({ severity: "error", code: "event_after_ingestion", detail: event.eventId });
    if (event.researchEligibleAt < event.publishedAt) issues.push({ severity: "error", code: "event_availability_inversion", detail: event.eventId });
    if (!event.sourceUrl.startsWith("https://ofac.treasury.gov/")) issues.push({ severity: "error", code: "event_source", detail: `${event.eventId}: ${event.sourceUrl}` });
  }
  return issues;
}

export function artifactIssue(file: string, expectedSha256: string | null): ManifestQaIssue | null {
  if (!expectedSha256) return { severity: "error", code: "raw_missing", detail: `${file}: hash is absent from manifest` };
  if (!existsSync(file)) return { severity: "error", code: "raw_missing", detail: `${file}: file is absent` };
  const actual = sha256Text(readFileSync(file, "utf8"));
  return actual === expectedSha256 ? null : { severity: "error", code: "raw_hash", detail: `${file}: expected ${expectedSha256}, got ${actual}` };
}
