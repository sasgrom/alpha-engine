import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { macroPointFingerprint, type MacroPointBackupRow } from "./macro-window-remediation";
import type { FredObservation, NormalizedMacroPoint } from "./fred";

export interface MacroSourceDecision {
  id: number;
  seriesId: "FEDFUNDS" | "CPIAUCSL";
  action: "delete_noncanonical_duplicate" | "update_availability";
  before: MacroPointBackupRow;
  canonical: MacroPointBackupRow | null;
  realtimeStartAfter?: string;
  realtimeEndAfter?: null;
}
export interface MacroSourcePlan {
  status: "planned" | "mismatch";
  decisions: MacroSourceDecision[];
  mismatches: { id: number; reasons: string[] }[];
  officialEvidence: Record<string, NormalizedMacroPoint>;
  fingerprint: string;
}
export interface MacroSourceTransaction {
  execute: (query: SQL) => Promise<unknown>;
}
export interface MacroSourceDatabase {
  transaction: <T>(callback: (tx: MacroSourceTransaction) => Promise<T>) => Promise<T>;
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sameRow = (left: MacroPointBackupRow, right: MacroPointBackupRow) => macroPointFingerprint([left]) === macroPointFingerprint([right]);
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const rawRow = (row: any): MacroPointBackupRow => ({ id: Number(row.id), seriesId: row.seriesId, date: String(row.date).slice(0, 10), value: row.value, realtimeStart: row.realtimeStart, realtimeEnd: row.realtimeEnd, fetchedAt: iso(row.fetchedAt) });
const officialRow = (archive: readonly NormalizedMacroPoint[], seriesId: string, observationPeriod: string, value: number, realtimeStart: string) => archive.filter((row) => row.seriesId === seriesId && row.observationPeriod === observationPeriod && row.value === value && row.availableAt === `${realtimeStart}T00:00:00.000Z` && row.supersededAt === null);

export function buildMacroSourcePlan(
  rows: readonly MacroPointBackupRow[],
  fedArchive: readonly NormalizedMacroPoint[],
  cpiArchive: readonly NormalizedMacroPoint[],
): MacroSourcePlan {
  const mismatches: MacroSourcePlan["mismatches"] = [];
  const decisions: MacroSourceDecision[] = [];
  const fedOfficial = officialRow(fedArchive, "FEDFUNDS", "2026-09-01", 3.75, "2026-10-01");
  const cpiOfficial = officialRow(cpiArchive, "CPIAUCSL", "2026-09-01", 336.298, "2026-10-14");
  if (fedOfficial.length !== 1) mismatches.push({ id: 47763, reasons: [`fed_official_count_${fedOfficial.length}`] });
  if (cpiOfficial.length !== 1) mismatches.push({ id: 47832, reasons: [`cpi_official_count_${cpiOfficial.length}`] });
  const fed = rows.find((row) => row.id === 47763);
  const cpi = rows.find((row) => row.id === 47832);
  if (!fed || fed.seriesId !== "FEDFUNDS" || fed.date !== "2026-09-01" || fed.value !== 3.75 || fed.realtimeStart !== "2026-10-19" || fed.realtimeEnd !== "2026-10-19") mismatches.push({ id: 47763, reasons: ["legacy_fed_row_mismatch"] });
  if (!cpi || cpi.seriesId !== "CPIAUCSL" || cpi.date !== "2026-09-01" || cpi.value !== 336.298 || cpi.realtimeStart !== "2026-10-19" || cpi.realtimeEnd !== "2026-10-19") mismatches.push({ id: 47832, reasons: ["legacy_cpi_row_mismatch"] });
  const fedCanonical = rows.filter((row) => row.seriesId === "FEDFUNDS" && row.date === "2026-09-01" && row.realtimeStart === "2026-10-01");
  if (fedCanonical.length > 1) mismatches.push({ id: 47763, reasons: ["multiple_fed_canonical_rows"] });
  if (fedCanonical.length === 1 && (fedCanonical[0].value !== 3.75 || fedCanonical[0].realtimeEnd !== null)) mismatches.push({ id: 47763, reasons: ["fed_canonical_mismatch"] });
  const cpiCanonical = rows.find((row) => row.id === 31824);
  if (!cpiCanonical || cpiCanonical.seriesId !== "CPIAUCSL" || cpiCanonical.date !== "2026-09-01" || cpiCanonical.value !== 336.298 || cpiCanonical.realtimeStart !== "2026-10-14" || cpiCanonical.realtimeEnd !== null) mismatches.push({ id: 47832, reasons: ["cpi_canonical_missing_or_mismatch"] });
  if (fed && mismatches.every((item) => item.id !== 47763)) {
    decisions.push(fedCanonical.length === 1
      ? { id: fed.id, seriesId: "FEDFUNDS", action: "delete_noncanonical_duplicate", before: fed, canonical: fedCanonical[0] }
      : { id: fed.id, seriesId: "FEDFUNDS", action: "update_availability", before: fed, canonical: null, realtimeStartAfter: "2026-10-01", realtimeEndAfter: null });
  }
  if (cpi && cpiCanonical && mismatches.every((item) => item.id !== 47832)) decisions.push({ id: cpi.id, seriesId: "CPIAUCSL", action: "delete_noncanonical_duplicate", before: cpi, canonical: cpiCanonical });
  const officialEvidence: Record<string, NormalizedMacroPoint> = {};
  if (fedOfficial.length === 1) officialEvidence.FEDFUNDS = fedOfficial[0];
  if (cpiOfficial.length === 1) officialEvidence.CPIAUCSL = cpiOfficial[0];
  const status = mismatches.length || decisions.length !== 2 ? "mismatch" : "planned";
  return { status, decisions, mismatches, officialEvidence, fingerprint: hash({ decisions, mismatches, officialEvidence }) };
}

function assertLocked(row: MacroPointBackupRow, expected: MacroPointBackupRow, id: number) {
  if (!sameRow(row, expected)) throw new Error(`Locked row mismatch for id ${id}`);
}

/** Apply only reviewed exact-ID decisions in one transaction; never change canonical rows. */
export async function applyMacroSourcePlan(db: MacroSourceDatabase, plan: MacroSourcePlan) {
  if (plan.status !== "planned" || plan.decisions.length !== 2 || plan.mismatches.length) throw new Error("Refusing apply without two exact evidence-backed decisions");
  return db.transaction(async (tx) => {
    const deletedIds: number[] = [];
    const updatedIds: number[] = [];
    const after: MacroPointBackupRow[] = [];
    for (const decision of plan.decisions) {
      if (decision.canonical) {
        const [canonicalRows]: any = await tx.execute(sql`SELECT id, seriesId, date, value, realtimeStart, realtimeEnd, fetchedAt FROM macro_points WHERE id = ${decision.canonical.id} FOR UPDATE`);
        if (!Array.isArray(canonicalRows) || canonicalRows.length !== 1) throw new Error(`Canonical row missing for id ${decision.canonical.id}`);
        assertLocked(rawRow(canonicalRows[0]), decision.canonical, decision.canonical.id);
      }
      const [lockedRows]: any = await tx.execute(sql`SELECT id, seriesId, date, value, realtimeStart, realtimeEnd, fetchedAt FROM macro_points WHERE id = ${decision.id} FOR UPDATE`);
      if (!Array.isArray(lockedRows) || lockedRows.length !== 1) throw new Error(`Expected locked row ${decision.id}`);
      assertLocked(rawRow(lockedRows[0]), decision.before, decision.id);
      if (decision.action === "delete_noncanonical_duplicate") {
        const [result]: any = await tx.execute(sql`DELETE FROM macro_points WHERE id = ${decision.id} AND seriesId = ${decision.before.seriesId} AND date = ${decision.before.date} AND realtimeStart = ${decision.before.realtimeStart} AND realtimeEnd = ${decision.before.realtimeEnd} AND value = ${decision.before.value}`);
        if (Number(result?.affectedRows ?? 0) !== 1) throw new Error(`Exact duplicate delete failed for id ${decision.id}`);
        deletedIds.push(decision.id);
      } else {
        const start = decision.realtimeStartAfter!;
        const [existing]: any = await tx.execute(sql`SELECT id FROM macro_points WHERE seriesId = ${decision.before.seriesId} AND date = ${decision.before.date} AND realtimeStart = ${start} FOR UPDATE`);
        if (Array.isArray(existing) && existing.length) throw new Error(`Refusing to create a duplicate vintage for id ${decision.id}`);
        const [result]: any = await tx.execute(sql`UPDATE macro_points SET realtimeStart = ${start}, realtimeEnd = NULL WHERE id = ${decision.id} AND realtimeStart = ${decision.before.realtimeStart} AND realtimeEnd = ${decision.before.realtimeEnd} AND value = ${decision.before.value}`);
        if (Number(result?.affectedRows ?? 0) !== 1) throw new Error(`Exact availability update failed for id ${decision.id}`);
        updatedIds.push(decision.id);
      }
      const [afterRows]: any = await tx.execute(sql`SELECT id, seriesId, date, value, realtimeStart, realtimeEnd, fetchedAt FROM macro_points WHERE id = ${decision.id}`);
      if (decision.action === "delete_noncanonical_duplicate") {
        if (!Array.isArray(afterRows) || afterRows.length !== 0) throw new Error(`Duplicate row still exists for id ${decision.id}`);
      } else {
        if (!Array.isArray(afterRows) || afterRows.length !== 1) throw new Error(`Updated row missing for id ${decision.id}`);
        const expected = { ...decision.before, realtimeStart: decision.realtimeStartAfter!, realtimeEnd: null };
        assertLocked(rawRow(afterRows[0]), expected, decision.id);
        after.push(rawRow(afterRows[0]));
      }
    }
    return { transactionCount: 1, deletedIds, updatedIds, after };
  });
}

export function verifyMacroSourceTable(beforeRows: readonly MacroPointBackupRow[], afterRows: readonly MacroPointBackupRow[], plan: MacroSourcePlan) {
  const before = new Map(beforeRows.map((row) => [row.id, row]));
  const after = new Map(afterRows.map((row) => [row.id, row]));
  const expectedDeleted = plan.decisions.filter((row) => row.action === "delete_noncanonical_duplicate").map((row) => row.id);
  const expectedUpdated = plan.decisions.filter((row) => row.action === "update_availability").map((row) => row.id);
  const actualDeleted = [...before.keys()].filter((id) => !after.has(id));
  const newIds = [...after.keys()].filter((id) => !before.has(id));
  const unexpectedChanges: unknown[] = [];
  for (const decision of plan.decisions) {
    const beforeRow = before.get(decision.id);
    const afterRow = after.get(decision.id);
    if (decision.action === "delete_noncanonical_duplicate") {
      if (afterRow) unexpectedChanges.push({ id: decision.id, reason: "duplicate_not_deleted" });
      if (!decision.canonical || !after.has(decision.canonical.id)) unexpectedChanges.push({ id: decision.canonical?.id, reason: "canonical_missing" });
    } else {
      if (!afterRow || afterRow.realtimeStart !== decision.realtimeStartAfter || afterRow.realtimeEnd !== null || afterRow.value !== beforeRow?.value || afterRow.date !== beforeRow?.date || iso(afterRow.fetchedAt) !== iso(beforeRow?.fetchedAt)) unexpectedChanges.push({ id: decision.id, reason: "unexpected_update_fields" });
    }
  }
  for (const [id, row] of before) {
    if (expectedDeleted.includes(id) || expectedUpdated.includes(id)) continue;
    const current = after.get(id);
    if (!current || !sameRow(row, current)) unexpectedChanges.push({ id, reason: "unexpected_other_row_change" });
  }
  const groups = new Map<string, number>();
  for (const row of afterRows) {
    const key = `${row.seriesId}|${row.date}|${row.realtimeStart ?? "<null>"}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const duplicateGroups = [...groups.values()].filter((count) => count > 1).length;
  const inversions = afterRows.filter((row) => row.realtimeStart && row.realtimeEnd && row.realtimeStart > row.realtimeEnd).length;
  const nullStarts = afterRows.filter((row) => row.realtimeStart === null).length;
  const idsMatch = actualDeleted.length === expectedDeleted.length && expectedDeleted.every((id) => actualDeleted.includes(id));
  const status = idsMatch && !newIds.length && !unexpectedChanges.length && !duplicateGroups && !inversions && !nullStarts ? "pass" : "fail";
  return { status, beforeRows: beforeRows.length, afterRows: afterRows.length, deletedIds: actualDeleted, updatedIds: expectedUpdated, newIds, unexpectedChanges, duplicateGroups, availabilityInversions: inversions, nullRealtimeStartRows: nullStarts };
}

export interface BamlChunkEvidence {
  metadata: { id: string };
  observations: FredObservation[];
  vintageDates: string[];
}

export function classifyBamlChunk(local: BamlChunkEvidence, official: BamlChunkEvidence) {
  const invalidWindows: unknown[] = [];
  const keyOf = (row: FredObservation) => `${row.date}|${row.realtime_start}`;
  const groups = new Map<string, FredObservation[]>();
  for (const row of local.observations) {
    groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^\d{4}-\d{2}-\d{2}$/.test(row.realtime_start) || typeof row.value !== "string") invalidWindows.push({ row, reason: "invalid_observation_structure" });
    if (row.date < "2023-10-31" || row.date > "2023-12-31") invalidWindows.push({ row, reason: "outside_target_period" });
    if (row.realtime_end && row.realtime_end !== "." && row.realtime_end !== "9999-12-31" && row.realtime_start > row.realtime_end) invalidWindows.push({ row, reason: "availability_inversion" });
  }
  const conflicts = [...groups.values()].filter((group) => new Set(group.map((row) => JSON.stringify([row.value, row.realtime_end]))).size > 1).length;
  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1).length;
  const observationStructureMatches = JSON.stringify(local.observations) === JSON.stringify(official.observations);
  const vintageStructureMatches = JSON.stringify(local.vintageDates) === JSON.stringify(official.vintageDates);
  const seriesMatches = local.metadata.id === "BAMLH0A0HYM2" && official.metadata.id === "BAMLH0A0HYM2";
  const classification = seriesMatches && !invalidWindows.length && !conflicts && observationStructureMatches && vintageStructureMatches ? "OFFICIAL_VALID_CHUNK" : "UNVERIFIED_OR_STALE_CHUNK";
  return {
    classification,
    reason: classification === "OFFICIAL_VALID_CHUNK" ? "Official response matches all local observations, values and availability dates" : "Official response or local source structure does not exactly match official vintage evidence",
    observationStructureMatches,
    vintageStructureMatches,
    invalidWindows,
    conflicts,
    duplicateGroups,
    local: { observations: local.observations.length, vintageDates: local.vintageDates.length, firstObservation: local.observations[0]?.date ?? null, lastObservation: local.observations.at(-1)?.date ?? null, firstVintage: local.vintageDates[0] ?? null, lastVintage: local.vintageDates.at(-1) ?? null },
    official: { observations: official.observations.length, vintageDates: official.vintageDates.length, firstObservation: official.observations[0]?.date ?? null, lastObservation: official.observations.at(-1)?.date ?? null, firstVintage: official.vintageDates[0] ?? null, lastVintage: official.vintageDates.at(-1) ?? null },
  };
}
