import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { documents, filings } from "@db/schema";
import { PRESENTATION_FORMS } from "../../worker/lib/document-presentation";

export const workerDocumentSnapshotRowZ = z.object({
  cik: z.number().int().positive(),
  accessionNo: z.string().min(1).max(25),
  form: z.enum(PRESENTATION_FORMS),
  filingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  primaryDoc: z.string().min(1).max(255),
  docName: z.string().min(1).max(255),
  docType: z.enum(PRESENTATION_FORMS),
  role: z.enum(["primary", "exhibit", "other"]),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  textKey: z.null(),
  textLength: z.number().int().nonnegative(),
  parserVersion: z.number().int().positive(),
  location: z.literal("none"),
  fetchStatus: z.literal("fetched"),
  fetchError: z.null(),
  fetchedAt: z.string().datetime().nullish(),
  storageKey: z.null(),
}).strict();
export type WorkerDocumentSnapshotRow = z.infer<typeof workerDocumentSnapshotRowZ>;
export const workerDocumentsSnapshotBodyZ = z.object({
  kind: z.literal("documentsSnapshot"),
  rows: z.array(workerDocumentSnapshotRowZ).min(1).max(100),
}).strict();

export async function ingestDocumentsSnapshot(rows: WorkerDocumentSnapshotRow[], dependencies: { db?: any } = {}) {
  const db = dependencies.db ?? getDb();
  let upserted = 0;
  for (const row of rows) {
    const [existing] = await db.select().from(documents).where(and(eq(documents.cik, row.cik), eq(documents.accessionNo, row.accessionNo), eq(documents.docName, row.docName))).limit(1);
    await db.insert(filings).values({
      cik: row.cik,
      accessionNo: row.accessionNo,
      form: row.form,
      filingDate: row.filingDate,
      reportDate: row.reportDate ?? null,
      primaryDoc: row.primaryDoc,
    }).onDuplicateKeyUpdate({ set: { primaryDoc: row.primaryDoc } });
    await db.insert(documents).values({
      cik: row.cik,
      accessionNo: row.accessionNo,
      form: row.form,
      docName: row.docName,
      docType: row.docType,
      role: row.role,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      storageKey: existing?.storageKey ?? null,
      textKey: existing?.textKey ?? null,
      textLength: row.textLength,
      parserVersion: row.parserVersion,
      location: existing?.location ?? "none",
      fetchStatus: "fetched",
      fetchedAt: new Date(),
      fetchError: null,
    }).onDuplicateKeyUpdate({
      set: {
        docType: row.docType,
        role: row.role,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
        storageKey: existing?.storageKey ?? null,
        textKey: existing?.textKey ?? null,
        textLength: row.textLength,
        parserVersion: row.parserVersion,
        location: existing?.location ?? "none",
        fetchStatus: "fetched",
        fetchedAt: new Date(),
        fetchError: null,
      },
      where: and(eq(documents.cik, row.cik), eq(documents.accessionNo, row.accessionNo), eq(documents.docName, row.docName)),
    });
    upserted++;
  }
  return { upserted };
}
