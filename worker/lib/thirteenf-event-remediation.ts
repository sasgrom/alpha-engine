/**
 * Reviewed, fail-closed remediation for historical 13F position events.
 * Classification and plans are pure; only an explicit apply deletes exact IDs
 * inside one transaction. The existing DB-only rebuild owns event insertion.
 */
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { normalizeFilingDate } from "./thirteenf";

export const THIRTEENF_REMEDIATION_BATCH_SIZE = 500;
export type ThirteenFRemediationClass = "VALID" | "STALE_FALLBACK" | "MISSING_REQUIRED_AVAILABILITY" | "DUPLICATE" | "UNKNOWN";

export interface ThirteenFPositionRow {
  id: number;
  cik: number;
  source: string;
  signalType: string;
  eventTs: string;
  ingestedAt: string;
  payloadKey: string | null;
  score: number | null;
  magnitude: number | null;
  note: string | null;
  src: string;
}
export interface ThirteenFQuarterMetadata {
  fundCik: number;
  quarterDate: string;
  accessionNo: string | null;
  filingDate: string | null;
}
export interface ThirteenFHoldingAccession {
  fundCik: number;
  quarterDate: string;
  accessionNo: string | null;
}
export interface ThirteenFAuditedRow {
  row: ThirteenFPositionRow;
  classification: ThirteenFRemediationClass;
  reason: string;
  fundCik: number | null;
  quarterDate: string | null;
  requiredAvailability: string | null;
  accessionNo: string | null;
  duplicateOfId: number | null;
}
export interface ThirteenFRemediationPlan {
  schemaVersion: 1;
  generatedAt: string;
  fingerprint: string;
  rows: ThirteenFAuditedRow[];
  counts: Record<ThirteenFRemediationClass, number>;
  deleteCandidates: { id: number; classification: Exclude<ThirteenFRemediationClass, "VALID" | "UNKNOWN">; reason: string }[];
  validUntouched: number[];
  unknownUntouched: number[];
  duplicateGroups: { key: string; canonicalId: number; duplicateIds: number[] }[];
  missingAvailabilityQuarters: { fundCik: number; quarterDate: string; reason: string }[];
}
export interface ThirteenFRemediationResult {
  dryRun: false;
  batches: number;
  affectedRows: number;
  deletedByClass: Record<"STALE_FALLBACK" | "MISSING_REQUIRED_AVAILABILITY" | "DUPLICATE", number>;
}
export interface ThirteenFRemediationTransaction {
  execute: (query: SQL) => Promise<unknown>;
}
export interface ThirteenFRemediationDatabase {
  transaction: <T>(callback: (tx: ThirteenFRemediationTransaction) => Promise<T>) => Promise<T>;
}

const dateOnly = (value: unknown): string => String(value).slice(0, 10);
const keyOf = (row: ThirteenFPositionRow) => `${row.cik}|${row.source}|${row.signalType}|${row.eventTs}|${row.payloadKey ?? ""}`;
const plusDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function fingerprint(rows: ThirteenFPositionRow[]): string {
  const normalized = rows.map((row) => [
    row.id, row.cik, row.source, row.signalType, row.eventTs, row.ingestedAt,
    row.payloadKey, row.score, row.magnitude, row.note, row.src,
  ]).sort((a, b) => Number(a[0]) - Number(b[0]));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function auditEvidence(row: ThirteenFPositionRow, quarters: ThirteenFQuarterMetadata[], accessions: ThirteenFHoldingAccession[]): Omit<ThirteenFAuditedRow, "duplicateOfId"> {
  const match = /^13f:pos:(\d+):(\d+):(COM|PUT|CALL):([A-Za-z0-9-]+)$/.exec(row.payloadKey ?? "");
  if (!match) return { row, classification: "UNKNOWN", reason: "payloadKey does not contain fundCik/heldCik/secClass/accessionNo", fundCik: null, quarterDate: null, requiredAvailability: null, accessionNo: null };
  const fundCik = Number(match[1]);
  const heldCik = Number(match[2]);
  const accessionNo = match[4];
  if (heldCik !== row.cik) return { row, classification: "UNKNOWN", reason: "payloadKey heldCik differs from signal cik", fundCik, quarterDate: null, requiredAvailability: null, accessionNo };
  const quarterDates = [...new Set([
    ...accessions.filter((item) => item.accessionNo === accessionNo && item.fundCik === fundCik).map((item) => dateOnly(item.quarterDate)),
    ...quarters.filter((item) => item.accessionNo === accessionNo && item.fundCik === fundCik).map((item) => dateOnly(item.quarterDate)),
  ])].sort();
  if (quarterDates.length === 0) return { row, classification: "UNKNOWN", reason: "accession is not present in the local holdings/book lineage", fundCik, quarterDate: null, requiredAvailability: null, accessionNo };
  if (quarterDates.length > 1) return { row, classification: "UNKNOWN", reason: `accession maps to multiple quarters: ${quarterDates.join(",")}`, fundCik, quarterDate: null, requiredAvailability: null, accessionNo };
  const quarterDate = quarterDates[0];
  const book = quarters.filter((item) => item.fundCik === fundCik && dateOnly(item.quarterDate) === quarterDate);
  if (book.length === 0) return { row, classification: "MISSING_REQUIRED_AVAILABILITY", reason: `MISSING_13F_FILING_DATE ${fundCik}/${quarterDate}: fund_quarters row is missing`, fundCik, quarterDate, requiredAvailability: null, accessionNo };
  const availabilities = [...new Set(book.map((item) => normalizeFilingDate(item.filingDate)).filter(Boolean))];
  if (availabilities.length === 0) return { row, classification: "MISSING_REQUIRED_AVAILABILITY", reason: `MISSING_13F_FILING_DATE ${fundCik}/${quarterDate}`, fundCik, quarterDate, requiredAvailability: null, accessionNo };
  if (availabilities.length > 1) return { row, classification: "UNKNOWN", reason: `conflicting filing availability: ${availabilities.join(",")}`, fundCik, quarterDate, requiredAvailability: null, accessionNo };
  const requiredAvailability = availabilities[0];
  const eventDate = normalizeFilingDate(dateOnly(row.eventTs));
  if (!eventDate) return { row, classification: "UNKNOWN", reason: "eventTs is not a valid date", fundCik, quarterDate, requiredAvailability, accessionNo };
  if (eventDate < requiredAvailability) {
    const fallback = eventDate === quarterDate ? "quarter-end fallback" : eventDate === plusDays(quarterDate, 45) ? "quarter+45d fallback" : "early availability fallback";
    return { row, classification: "STALE_FALLBACK", reason: `${fallback}: eventTs ${eventDate} precedes actual merged availability ${requiredAvailability}`, fundCik, quarterDate, requiredAvailability, accessionNo };
  }
  if (eventDate > requiredAvailability) return { row, classification: "UNKNOWN", reason: `eventTs ${eventDate} follows required availability ${requiredAvailability}; manual review required`, fundCik, quarterDate, requiredAvailability, accessionNo };
  return { row, classification: "VALID", reason: "eventTs matches actual merged-book availability", fundCik, quarterDate, requiredAvailability, accessionNo };
}

/** Build an exact-ID plan. Duplicate IDs are secondary only; the lowest-ID
 * canonical row is preserved and receives its own evidence classification. */
export function buildThirteenFRemediationPlan(
  rows: ThirteenFPositionRow[],
  quarters: ThirteenFQuarterMetadata[],
  accessions: ThirteenFHoldingAccession[],
  generatedAt = new Date().toISOString(),
): ThirteenFRemediationPlan {
  const groups = new Map<string, ThirteenFPositionRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const duplicateGroups = [...groups.entries()].filter(([, group]) => group.length > 1).map(([key, group]) => {
    const sorted = [...group].sort((a, b) => a.id - b.id);
    return { key, canonicalId: sorted[0].id, duplicateIds: sorted.slice(1).map((row) => row.id) };
  });
  const duplicates = new Map(duplicateGroups.flatMap((group) => group.duplicateIds.map((id) => [id, group.canonicalId])));
  const audited = rows.map((row) => {
    const evidence = auditEvidence(row, quarters, accessions);
    const duplicateOfId = duplicates.get(row.id) ?? null;
    return duplicateOfId !== null && evidence.classification !== "UNKNOWN"
      ? { ...evidence, classification: "DUPLICATE" as const, reason: `${evidence.reason}; duplicate of canonical id ${duplicateOfId}`, duplicateOfId }
      : { ...evidence, duplicateOfId };
  });
  const counts = Object.fromEntries(["VALID", "STALE_FALLBACK", "MISSING_REQUIRED_AVAILABILITY", "DUPLICATE", "UNKNOWN"].map((classification) => [classification, audited.filter((row) => row.classification === classification).length])) as ThirteenFRemediationPlan["counts"];
  const missing = new Map<string, { fundCik: number; quarterDate: string; reason: string }>();
  for (const row of audited) if (row.classification === "MISSING_REQUIRED_AVAILABILITY" && row.fundCik !== null && row.quarterDate !== null) missing.set(`${row.fundCik}|${row.quarterDate}`, { fundCik: row.fundCik, quarterDate: row.quarterDate, reason: row.reason });
  return {
    schemaVersion: 1,
    generatedAt,
    fingerprint: fingerprint(rows),
    rows: audited,
    counts,
    deleteCandidates: audited.filter((row) => ["STALE_FALLBACK", "MISSING_REQUIRED_AVAILABILITY", "DUPLICATE"].includes(row.classification)).map((row) => ({ id: row.row.id, classification: row.classification as "STALE_FALLBACK" | "MISSING_REQUIRED_AVAILABILITY" | "DUPLICATE", reason: row.reason })),
    validUntouched: audited.filter((row) => row.classification === "VALID").map((row) => row.row.id),
    unknownUntouched: audited.filter((row) => row.classification === "UNKNOWN").map((row) => row.row.id),
    duplicateGroups,
    missingAvailabilityQuarters: [...missing.values()].sort((a, b) => a.fundCik - b.fundCik || a.quarterDate.localeCompare(b.quarterDate)),
  };
}

/** Apply only an explicit reviewed plan, deleting exact IDs in bounded batches. */
export async function applyThirteenFRemediationPlan(
  db: ThirteenFRemediationDatabase,
  plan: ThirteenFRemediationPlan,
): Promise<ThirteenFRemediationResult> {
  return db.transaction(async (tx) => {
    const deletedByClass = { STALE_FALLBACK: 0, MISSING_REQUIRED_AVAILABILITY: 0, DUPLICATE: 0 };
    let affectedRows = 0;
    let batches = 0;
    for (const classification of ["STALE_FALLBACK", "MISSING_REQUIRED_AVAILABILITY", "DUPLICATE"] as const) {
      const ids = plan.deleteCandidates.filter((row) => row.classification === classification).map((row) => row.id);
      for (let offset = 0; offset < ids.length; offset += THIRTEENF_REMEDIATION_BATCH_SIZE) {
        const batch = ids.slice(offset, offset + THIRTEENF_REMEDIATION_BATCH_SIZE);
        const [result]: any = await tx.execute(sql`DELETE FROM signals WHERE id IN (${sql.join(batch.map((id) => sql`${id}`), sql`, `)})`);
        const affected = Number(result?.affectedRows ?? 0);
        affectedRows += affected;
        deletedByClass[classification] += affected;
        batches++;
      }
    }
    return { dryRun: false, batches, affectedRows, deletedByClass };
  });
}
