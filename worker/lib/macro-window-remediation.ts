import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import type { NormalizedMacroVintageRow } from "./macro-vintage-backfill";

export interface MacroPointBackupRow {
  id: number;
  seriesId: string;
  date: string;
  value: number | null;
  realtimeStart: string | null;
  realtimeEnd: string | null;
  fetchedAt: string | Date;
}
export interface MacroWindowTarget {
  id: number;
  seriesId: string;
  observationPeriod: string;
  realtimeStart: string;
  value: number;
}
export interface MacroWindowDiff {
  id: number;
  seriesId: string;
  observationPeriod: string;
  realtimeStart: string;
  value: number;
  realtimeEndBefore: string;
  realtimeEndAfter: null;
  fetchedAt: string;
}
export interface MacroWindowPlan {
  status: "planned" | "mismatch";
  diffs: MacroWindowDiff[];
  mismatches: { id: number; reasons: string[] }[];
  officialEvidence: Record<string, { path: string; sha256: string }>;
  fingerprint: string;
}
export interface MacroWindowTransaction {
  execute: (query: SQL) => Promise<unknown>;
}
export interface MacroWindowDatabase {
  transaction: <T>(callback: (tx: MacroWindowTransaction) => Promise<T>) => Promise<T>;
}

export const EXACT_MACRO_WINDOW_TARGETS: MacroWindowTarget[] = [
  { id: 44671, seriesId: "DGS10", observationPeriod: "2026-10-16", realtimeStart: "2026-10-19", value: 5.09 },
  { id: 46182, seriesId: "DGS2", observationPeriod: "2026-10-16", realtimeStart: "2026-10-19", value: 4.74 },
  { id: 47694, seriesId: "T10Y2Y", observationPeriod: "2026-10-19", realtimeStart: "2026-10-19", value: 0.38 },
  { id: 31824, seriesId: "CPIAUCSL", observationPeriod: "2026-09-01", realtimeStart: "2026-10-14", value: 336.298 },
  { id: 32769, seriesId: "UNRATE", observationPeriod: "2026-09-01", realtimeStart: "2026-10-02", value: 4.2 },
];

const iso = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const mysqlTimestamp = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(text);
  // Raw MySQL UTC timestamps must compare equal to the corresponding Date instance.
  if (mysqlTimestamp) return `${mysqlTimestamp[1]}T${mysqlTimestamp[2]}.${(mysqlTimestamp[3] ?? "0").padEnd(3, "0").slice(0, 3)}Z`;
  return text;
};
const day = (value: unknown) => iso(value).slice(0, 10);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const canonicalRows = (rows: readonly MacroPointBackupRow[]) => rows.map((row) => ({
  id: Number(row.id),
  seriesId: row.seriesId,
  date: day(row.date),
  value: row.value,
  realtimeStart: row.realtimeStart ? day(row.realtimeStart) : null,
  realtimeEnd: row.realtimeEnd ? day(row.realtimeEnd) : null,
  fetchedAt: iso(row.fetchedAt),
})).sort((a, b) => a.id - b.id);
const rowKey = (row: { seriesId: string; date: string; realtimeStart: string | null }) => `${row.seriesId}|${row.date}|${row.realtimeStart ?? "<null>"}`;

export function macroPointFingerprint(rows: readonly MacroPointBackupRow[]): string {
  return hash(JSON.stringify(canonicalRows(rows)));
}

export function createMacroPointBackup(rows: readonly MacroPointBackupRow[], directory: string) {
  mkdirSync(directory, { recursive: true });
  const backupPath = path.join(directory, "backup-macro-points.json");
  const manifestPath = path.join(directory, "backup-manifest.json");
  if (existsSync(backupPath) || existsSync(manifestPath)) throw new Error(`Refusing to overwrite macro backup in ${directory}`);
  const backupRows = canonicalRows(rows);
  const backupText = `${JSON.stringify(backupRows, null, 2)}\n`;
  writeFileSync(backupPath, backupText, { flag: "wx" });
  const fingerprint = macroPointFingerprint(backupRows);
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    beforeAnyDbWrite: true,
    table: "macro_points",
    scope: "complete table ordered by id",
    rows: backupRows.length,
    bytes: Buffer.byteLength(backupText),
    sha256: hash(backupText),
    fingerprint,
    path: path.relative(process.cwd(), backupPath).replaceAll("\\", "/"),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

export function verifyMacroPointBackup(manifestPath: string, currentRows: readonly MacroPointBackupRow[]) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.beforeAnyDbWrite !== true || manifest.table !== "macro_points" || manifest.scope !== "complete table ordered by id") throw new Error("Invalid complete macro_points backup manifest");
  const backupPath = path.join(path.dirname(manifestPath), path.basename(manifest.path ?? "backup-macro-points.json"));
  const backupText = readFileSync(backupPath, "utf8");
  const backupRows = JSON.parse(backupText) as MacroPointBackupRow[];
  if (hash(backupText) !== manifest.sha256 || Buffer.byteLength(backupText) !== manifest.bytes) throw new Error("Backup SHA256 or size mismatch");
  if (backupRows.length !== manifest.rows || backupRows.length !== currentRows.length) throw new Error("Backup row-count mismatch");
  const fingerprint = macroPointFingerprint(currentRows);
  if (manifest.fingerprint !== fingerprint || fingerprint !== macroPointFingerprint(backupRows)) throw new Error("Current macro_points fingerprint differs from the reviewed backup");
  if (JSON.stringify(canonicalRows(backupRows)) !== JSON.stringify(canonicalRows(currentRows))) throw new Error("Current macro_points rows differ from the reviewed backup");
  return { manifest, backupPath, backupRows, fingerprint };
}

export function buildExactMacroWindowPlan(
  rows: readonly MacroPointBackupRow[],
  archives: Record<string, readonly NormalizedMacroVintageRow[]>,
  officialEvidence: Record<string, { path: string; sha256: string }> = {},
): MacroWindowPlan {
  const diffs: MacroWindowDiff[] = [];
  const mismatches: MacroWindowPlan["mismatches"] = [];
  for (const target of EXACT_MACRO_WINDOW_TARGETS) {
    const reasons: string[] = [];
    const row = rows.find((item) => item.id === target.id);
    if (!row) {
      mismatches.push({ id: target.id, reasons: ["target_row_missing"] });
      continue;
    }
    if (row.seriesId !== target.seriesId) reasons.push("seriesId_mismatch");
    if (day(row.date) !== target.observationPeriod) reasons.push("observationPeriod_mismatch");
    if (day(row.realtimeStart) !== target.realtimeStart) reasons.push("realtimeStart_mismatch");
    if (row.value !== target.value) reasons.push("legacy_value_mismatch");
    if (row.realtimeEnd !== target.realtimeStart) reasons.push("legacy_window_is_not_one_day_closed");
    const candidates = (archives[target.seriesId] ?? []).filter((item) => item.observationPeriod === target.observationPeriod && day(item.availableAt) === target.realtimeStart);
    if (candidates.length !== 1) reasons.push(`official_vintage_count_${candidates.length}`);
    for (const candidate of candidates) {
      if (candidate.seriesId !== target.seriesId) reasons.push("official_seriesId_mismatch");
      if (candidate.value !== target.value) reasons.push("official_value_mismatch");
      if (candidate.supersededAt !== null) reasons.push("official_vintage_is_not_open_ended");
    }
    if (reasons.length) {
      mismatches.push({ id: target.id, reasons });
      continue;
    }
    diffs.push({
      id: target.id,
      seriesId: target.seriesId,
      observationPeriod: target.observationPeriod,
      realtimeStart: target.realtimeStart,
      value: target.value,
      realtimeEndBefore: target.realtimeStart,
      realtimeEndAfter: null,
      fetchedAt: iso(row.fetchedAt),
    });
  }
  const status = mismatches.length || diffs.length !== EXACT_MACRO_WINDOW_TARGETS.length ? "mismatch" : "planned";
  return { status, diffs, mismatches, officialEvidence, fingerprint: hash(JSON.stringify({ diffs, mismatches, officialEvidence })) };
}

function normalizedRawRow(row: any): MacroPointBackupRow {
  return { id: Number(row.id), seriesId: String(row.seriesId), date: day(row.date), value: row.value === null ? null : Number(row.value), realtimeStart: row.realtimeStart ? day(row.realtimeStart) : null, realtimeEnd: row.realtimeEnd ? day(row.realtimeEnd) : null, fetchedAt: iso(row.fetchedAt) };
}
function assertLockedRow(row: MacroPointBackupRow, diff: MacroWindowDiff) {
  const expected = { id: diff.id, seriesId: diff.seriesId, date: diff.observationPeriod, value: diff.value, realtimeStart: diff.realtimeStart, realtimeEnd: diff.realtimeEndBefore, fetchedAt: diff.fetchedAt };
  if (JSON.stringify(canonicalRows([row])[0]) !== JSON.stringify(canonicalRows([expected])[0])) throw new Error(`Locked row changed or mismatched for id ${diff.id}`);
}

/** Change only five official-evidence-backed realtimeEnd fields in one transaction. */
export async function applyExactMacroWindowRemediation(db: MacroWindowDatabase, plan: MacroWindowPlan) {
  if (plan.status !== "planned" || plan.diffs.length !== EXACT_MACRO_WINDOW_TARGETS.length || plan.mismatches.length) throw new Error("Refusing apply without five exact evidence-backed diffs");
  return db.transaction(async (tx) => {
    const after: MacroPointBackupRow[] = [];
    for (const diff of plan.diffs) {
      const [lockedRows]: any = await tx.execute(sql`SELECT id, seriesId, date, value, realtimeStart, realtimeEnd, fetchedAt FROM macro_points WHERE id = ${diff.id} FOR UPDATE`);
      if (!Array.isArray(lockedRows) || lockedRows.length !== 1) throw new Error(`Expected one locked row for id ${diff.id}`);
      const locked = normalizedRawRow(lockedRows[0]);
      assertLockedRow(locked, diff);
      const [update]: any = await tx.execute(sql`UPDATE macro_points SET realtimeEnd = NULL WHERE id = ${diff.id} AND seriesId = ${diff.seriesId} AND date = ${diff.observationPeriod} AND realtimeStart = ${diff.realtimeStart} AND realtimeEnd = ${diff.realtimeEndBefore} AND value = ${diff.value}`);
      if (Number(update?.affectedRows ?? 0) !== 1) throw new Error(`Exact realtimeEnd update failed for id ${diff.id}`);
      const [afterRows]: any = await tx.execute(sql`SELECT id, seriesId, date, value, realtimeStart, realtimeEnd, fetchedAt FROM macro_points WHERE id = ${diff.id}`);
      if (!Array.isArray(afterRows) || afterRows.length !== 1) throw new Error(`Post-update row missing for id ${diff.id}`);
      const updated = normalizedRawRow(afterRows[0]);
      assertLockedRow(updated, { ...diff, realtimeEndBefore: null as unknown as string });
      if (updated.realtimeEnd !== null) throw new Error(`Vintage did not become open-ended for id ${diff.id}`);
      after.push(updated);
    }
    return { transactionCount: 1, updatedRows: after.length, updatedIds: after.map((row) => row.id), before: plan.diffs, after };
  });
}

export function verifyExactWindowTable(beforeRows: readonly MacroPointBackupRow[], afterRows: readonly MacroPointBackupRow[], expectedIds: readonly number[]) {
  const before = new Map(canonicalRows(beforeRows).map((row) => [row.id, row]));
  const after = canonicalRows(afterRows);
  const changed: unknown[] = [];
  const seen = new Set<number>();
  for (const row of after) {
    const original = before.get(row.id);
    if (!original) continue;
    seen.add(row.id);
    if (JSON.stringify(original) === JSON.stringify(row)) continue;
    const mismatch = { ...original, ...row, realtimeStart: original.realtimeStart, realtimeEnd: null, fetchedAt: original.fetchedAt };
    if (!expectedIds.includes(row.id) || JSON.stringify(mismatch) !== JSON.stringify(row)) changed.push({ id: row.id, before: original, after: row, reason: "unexpected_row_or_field_change" });
    else changed.push({ id: row.id, before: original, after: row, reason: "approved_realtimeEnd_only" });
  }
  const groups = new Map<string, number>();
  for (const row of after) groups.set(rowKey(row), (groups.get(rowKey(row)) ?? 0) + 1);
  const changedIds = changed.map((row: any) => row.id);
  const unexpectedChanges = changed.filter((row: any) => row.reason !== "approved_realtimeEnd_only");
  const missingOriginalIds = [...before.keys()].filter((id) => !seen.has(id));
  const correctIds = changedIds.length === expectedIds.length && expectedIds.every((id) => changedIds.includes(id));
  const result = {
    status: before.size === after.length && afterRows.length - changed.length === before.size - expectedIds.length && correctIds && !unexpectedChanges.length && !missingOriginalIds.length ? "pass" : "fail",
    beforeRows: before.size,
    afterRows: after.length,
    changedRows: changed.length,
    unchangedRows: after.length - changed.length,
    newRows: after.length - seen.size,
    missingOriginalIds,
    changed,
    unexpectedChanges,
    duplicateVintageGroups: [...groups.values()].filter((count) => count > 1).length,
    availabilityInversions: after.filter((row) => row.realtimeStart && row.realtimeEnd && row.realtimeStart > row.realtimeEnd).length,
    nullRealtimeStartRows: after.filter((row) => row.realtimeStart === null).length,
  };
  if (result.duplicateVintageGroups || result.availabilityInversions || result.nullRealtimeStartRows) result.status = "fail";
  return result;
}
