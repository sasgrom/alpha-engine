import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { documents, filings } from "@db/schema";
import { storage } from "../lib/storage";
import { canonicalDocKey, PARSER_VERSION } from "./documents";
import { unpackDocumentSnapshot } from "../../worker/lib/document-presentation";

export const workerDocumentSnapshotRowZ = z.object({
  cik: z.number().int().positive(),
  accessionNo: z.string().min(1).max(25),
  form: z.literal("10-K"),
  filingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  primaryDoc: z.string().min(1).max(255),
  docName: z.string().min(1).max(255),
  docType: z.literal("10-K"),
  role: z.literal("primary"),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  textKey: z.string().min(1).max(512),
  textLength: z.number().int().nonnegative(),
  parserVersion: z.number().int().positive(),
  rawGzipBase64: z.string().min(1).max(24 * 1024 * 1024),
  plaintext: z.string(),
});
export type WorkerDocumentSnapshotRow = z.infer<typeof workerDocumentSnapshotRowZ>;
export const workerDocumentsSnapshotBodyZ = z.object({
  kind: z.literal("documentsSnapshot"),
  rows: z.array(workerDocumentSnapshotRowZ).min(1).max(1),
});

type Upload = (input: { fileContent: Uint8Array; fileName: string; contentType?: string }) => Promise<{ key: string }>;

export async function ingestDocumentsSnapshot(rows: WorkerDocumentSnapshotRow[], dependencies: { db?: any; uploadFile?: Upload } = {}) {
  const db = dependencies.db ?? getDb();
  const uploadFile = dependencies.uploadFile ?? storage.uploadFile;
  let upserted = 0;
  for (const row of rows) {
    const raw = unpackDocumentSnapshot(row);
    const canonicalKey = canonicalDocKey(row.cik, row.accessionNo, row.docName);
    const savedRaw = await uploadFile({
      fileContent: new Uint8Array(raw),
      fileName: canonicalKey,
      contentType: row.docName.toLowerCase().endsWith(".txt") ? "text/plain" : "text/html",
    });
    const savedText = await uploadFile({
      fileContent: new TextEncoder().encode(row.plaintext),
      fileName: `${canonicalKey}.txt`,
      contentType: "text/plain",
    });
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
      storageKey: savedRaw.key,
      textKey: savedText.key,
      textLength: row.textLength,
      parserVersion: PARSER_VERSION,
      location: "cloud",
      fetchStatus: "fetched",
      fetchedAt: new Date(),
      fetchError: null,
    }).onDuplicateKeyUpdate({
      set: {
        docType: row.docType,
        role: row.role,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
        storageKey: savedRaw.key,
        textKey: savedText.key,
        textLength: row.textLength,
        parserVersion: PARSER_VERSION,
        location: "cloud",
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
