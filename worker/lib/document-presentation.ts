import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { documents, filings } from "@db/schema";
import { derivePlaintext } from "./edgar";

export const LOCAL_PARSER_VERSION = 1;
export const MAX_DOCUMENT_GZIP_BASE64_CHARS = 24 * 1024 * 1024;
export const PRESENTATION_FORMS = ["10-K", "10-Q", "8-K", "10-K/A", "10-Q/A", "8-K/A", "DEF 14A"] as const;
export type PresentationForm = typeof PRESENTATION_FORMS[number];

export interface PresentationFiling {
  cik: number;
  accessionNo: string;
  form: PresentationForm;
  filingDate: string;
  reportDate: string | null;
  primaryDoc: string;
}

export interface DocumentSnapshotRow extends PresentationFiling {
  docName: string;
  docType: PresentationForm;
  role: "primary" | "exhibit" | "other";
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

export function snapshotDocument(filing: PresentationFiling, raw: Buffer, options: { docName?: string; docType?: PresentationForm; role?: "primary" | "exhibit" | "other" } = {}): DocumentSnapshotRow {
  if (!raw.length) throw new Error(`Empty raw document for ${filing.accessionNo}`);
  const docName = options.docName ?? filing.primaryDoc;
  const plaintext = derivePlaintext(raw.toString("utf8"));
  const rawGzipBase64 = gzipSync(raw).toString("base64");
  if (rawGzipBase64.length > MAX_DOCUMENT_GZIP_BASE64_CHARS) throw new Error(`Compressed document exceeds the bounded request size for ${filing.accessionNo}`);
  return {
    ...filing,
    docName,
    docType: options.docType ?? filing.form,
    role: options.role ?? "primary",
    sizeBytes: raw.length,
    sha256: sha256Document(raw),
    textKey: localDocumentTextKey(filing.cik, filing.accessionNo, docName),
    textLength: plaintext.length,
    parserVersion: LOCAL_PARSER_VERSION,
    rawGzipBase64,
    plaintext,
  };
}

export interface DocumentMetadataSnapshotRow extends Omit<DocumentSnapshotRow, "rawGzipBase64" | "plaintext" | "textKey"> {
  storageKey: null;
  textKey: null;
  location: "none";
  fetchStatus: "fetched";
  fetchError: null;
  fetchedAt: string;
}

export function metadataDocument(row: DocumentSnapshotRow): DocumentMetadataSnapshotRow {
  const { rawGzipBase64: _raw, plaintext: _text, ...metadata } = row;
  return {
    ...metadata,
    storageKey: null,
    textKey: null,
    location: "none",
    fetchStatus: "fetched",
    fetchError: null,
    fetchedAt: new Date().toISOString(),
  };
}

export function unpackDocumentSnapshot(row: Pick<DocumentSnapshotRow, "rawGzipBase64" | "sha256" | "sizeBytes" | "plaintext" | "textLength">): Buffer {
  const raw = gunzipSync(Buffer.from(row.rawGzipBase64, "base64"));
  if (sha256Document(raw) !== row.sha256) throw new Error("Document raw SHA256 mismatch");
  if (raw.length !== row.sizeBytes) throw new Error("Document sizeBytes mismatch");
  if (row.plaintext.length !== row.textLength) throw new Error("Document textLength mismatch");
  return raw;
}

export async function registerLocalDocuments(db: any, rows: DocumentSnapshotRow[]): Promise<void> {
  if (!rows.length) return;
  const execute = async (executor: any) => {
    const uniqueFilings = [...new Map(rows.map((row) => [row.accessionNo, {
      cik: row.cik,
      accessionNo: row.accessionNo,
      form: row.form,
      filingDate: row.filingDate || null,
      reportDate: row.reportDate || null,
      primaryDoc: row.primaryDoc,
    }])).values()];
    for (let index = 0; index < uniqueFilings.length; index += 50) {
      const chunk = uniqueFilings.slice(index, index + 50);
      await executor.insert(filings).values(chunk).onDuplicateKeyUpdate({ set: { primaryDoc: sql`VALUES(\`primaryDoc\`)` } });
    }
    for (let index = 0; index < rows.length; index += 50) {
      const chunk = rows.slice(index, index + 50);
      await executor.insert(documents).values(chunk.map((row) => ({
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
      }))).onDuplicateKeyUpdate({
        set: {
          docType: sql`VALUES(\`docType\`)`,
          role: sql`VALUES(\`role\`)`,
          sizeBytes: sql`VALUES(\`sizeBytes\`)`,
          sha256: sql`VALUES(\`sha256\`)`,
          storageKey: null,
          textKey: sql`VALUES(\`textKey\`)`,
          textLength: sql`VALUES(\`textLength\`)`,
          parserVersion: sql`VALUES(\`parserVersion\`)`,
          location: "local",
          fetchStatus: "fetched",
          fetchedAt: new Date(),
          fetchError: null,
        },
      });
    }
  };
  if (typeof db.transaction === "function") return db.transaction(execute);
  return execute(db);
}

export async function registerLocalDocument(db: any, row: DocumentSnapshotRow): Promise<void> {
  return registerLocalDocuments(db, [row]);
}
