import { describe, expect, it } from "vitest";
import { metadataDocument, registerLocalDocument, sha256Document, snapshotDocument, unpackDocumentSnapshot, type PresentationFiling } from "./document-presentation";
import { documents } from "@db/schema";

const filing: PresentationFiling = {
  cik: 320193,
  accessionNo: "0000320193-26-000001",
  form: "10-K",
  filingDate: "2026-02-01",
  reportDate: "2025-12-31",
  primaryDoc: "aapl-20251231.htm",
};

function database() {
  const state = { documents: [{ cik: 1, accessionNo: "existing", docName: "keep.htm" }], filings: [] as any[] };
  return {
    state,
    insert(table: unknown) {
      return {
        values(row: any) {
          return {
            onDuplicateKeyUpdate: async () => {
              for (const item of Array.isArray(row) ? row : [row]) {
                if (table === documents) {
                  const index = state.documents.findIndex((existing) => existing.cik === item.cik && existing.accessionNo === item.accessionNo && existing.docName === item.docName);
                  if (index >= 0) state.documents[index] = { ...state.documents[index], ...item };
                  else state.documents.push(item);
                } else {
                  const index = state.filings.findIndex((existing) => existing.cik === item.cik && existing.accessionNo === item.accessionNo);
                  if (index >= 0) state.filings[index] = { ...state.filings[index], ...item };
                  else state.filings.push(item);
                }
              }
            },
          };
        },
      };
    },
  };
}

describe("local document presentation", () => {
  it("registers a local raw document with deterministic SHA256 and plaintext", async () => {
    const raw = Buffer.from("<html><head></head><body><h1>Annual report</h1><p>Revenue increased.</p></body></html>");
    const row = snapshotDocument(filing, raw);
    expect(row.sha256).toBe(sha256Document(raw));
    expect(row.textKey).toBe(`local:plaintext:${filing.cik}:${filing.accessionNo}:${filing.primaryDoc}`);
    expect(row.textLength).toBeGreaterThan(0);
    expect(unpackDocumentSnapshot(row).equals(raw)).toBe(true);
    const db = database();
    await registerLocalDocument(db, row);
    await registerLocalDocument(db, row);
    expect(db.state.documents).toHaveLength(2);
    expect(db.state.documents[0].docName).toBe("keep.htm");
    expect(db.state.documents[1].location).toBe("local");
    expect(db.state.documents[1].fetchStatus).toBe("fetched");
    expect(db.state.filings).toHaveLength(1);
  });

  it("rejects a hash mismatch during gzip round-trip validation", () => {
    const row = snapshotDocument(filing, Buffer.from("<p>raw</p>"));
    expect(() => unpackDocumentSnapshot({ ...row, sha256: "0".repeat(64) })).toThrow("SHA256 mismatch");
  });
});

it("keeps DEF 14A exhibit documents under their own exact key and role", () => {
  const row = snapshotDocument(filing, Buffer.from("<p>Proxy statement</p>"), {
    docName: "def14a-exhibit.htm",
    docType: "DEF 14A",
    role: "exhibit",
  });
  expect(row.docType).toBe("DEF 14A");
  expect(row.role).toBe("exhibit");
  expect(row.textKey).toBe(`local:plaintext:${filing.cik}:${filing.accessionNo}:def14a-exhibit.htm`);
  expect(unpackDocumentSnapshot(row).toString()).toContain("Proxy statement");
});

it("keeps only metadata in the transport snapshot while preserving local proof", () => {
  const row = metadataDocument(snapshotDocument(filing, Buffer.from("<p>Local raw</p>")));
  expect(row.rawGzipBase64).toBeUndefined();
  expect(row.plaintext).toBeUndefined();
  expect(row.storageKey).toBeNull();
  expect(row.textKey).toBeNull();
  expect(row.location).toBe("none");
  expect(row.fetchStatus).toBe("fetched");
  expect(row.fetchError).toBeNull();
  expect(row.sha256).toBe(sha256Document(Buffer.from("<p>Local raw</p>")));
  expect(row.textLength).toBeGreaterThan(0);
});
