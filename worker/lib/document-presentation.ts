import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import { documents, filings } from "@db/schema";
import { derivePlaintext } from "./edgar";

export const LOCAL_PARSER_VERSION = 1;
export const MAX_DOCUMENT_GZIP_BASE64_CHARS = 24 * 1024 * 1024;

export interface PresentationFiling {
  cik: number;
  accessionNo: string;
  form: "10-K";
  filingDate: string;
  reportDate: string | null;
  primaryDoc: string;
}

export interface DocumentSnapshotRow extends PresentationFiling {
  docName: string;
  docType: "10-K";
  role: "primary";
  sizeBytes: number;
  sha256: string;
  textKey: string;
  textLength: number;
  parserVersion: number;
  rawGzipBase64: string;
  plaintext: string;
}

export function sha256Document(raw: Buffer | string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function localDocumentTextKey(cik: number, accessionNo: string, docName: string): string {
  return `local:plaintext:${cik}:${accessionNo}:${docName}`;
}

export function snapshotDocument(filing: PresentationFiling, raw: Buffer): DocumentSnapshotRow {
  if (!raw.length) throw new Error(`Empty raw document for ${filing.accessionNo}`);
  const plaintext = derivePlaintext(raw.toString("utf8"));
  const rawGzipBase64 = gzipSync(raw).toString("base64");
  if (rawGzipBase64.length > MAX_DOCUMENT_GZIP_BASE64_CHARS) throw new Error(`Compressed document exceeds the bounded request size for ${filing.accessionNo}`);
  return {
    ...filing,
    docName: filing.primaryDoc,
    docType: "10-K",
    role: "primary",
    sizeBytes: raw.length,
    sha256: sha256Document(raw),
    textKey: localDocumentTextKey(filing.cik, filing.accessionNo, filing.primaryDoc),
    textLength: plaintext.length,
    parserVersion: LOCAL_PARSER_VERSION,
    rawGzipBase64,
    plaintext,
  };
}

export function unpackDocumentSnapshot(row: Pick<DocumentSnapshotRow, "rawGzipBase64" | "sha256" | "sizeBytes" | "plaintext" | "textLength">): Buffer {
  const raw = gunzipSync(Buffer.from(row.rawGzipBase64, "base64"));
  if (sha256Document(raw) !== row.sha256) throw new Error("Document raw SHA256 mismatch");
  if (raw.length !== row.sizeBytes) throw new Error("Document sizeBytes mismatch");
  if (row.plaintext.length !== row.textLength) throw new Error("Document textLength mismatch");
  return raw;
}

export async function registerLocalDocument(db: any, row: DocumentSnapshotRow): Promise<void> {
  await db.insert(filings).values({
    cik: row.cik,
    accessionNo: row.accessionNo,
    form: row.form,
    filingDate: row.filingDate || null,
    reportDate: row.reportDate || null,
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
    storageKey: null,
    textKey: row.textKey,
    textLength: row.textLength,
    parserVersion: row.parserVersion,
    location: "local",
    fetchStatus: "fetched",
    fetchedAt: new Date(),
    fetchError: null,
  }).onDuplicateKeyUpdate({
    set: {
      docType: row.docType,
      role: row.role,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      storageKey: null,
      textKey: row.textKey,
      textLength: row.textLength,
      parserVersion: row.parserVersion,
      location: "local",
      fetchStatus: "fetched",
      fetchedAt: new Date(),
      fetchError: null,
    },
    where: and(eq(documents.cik, row.cik), eq(documents.accessionNo, row.accessionNo), eq(documents.docName, row.docName)),
  });
}
