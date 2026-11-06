import { describe, expect, it } from "vitest";
import { registerLocalDocument, sha256Document, snapshotDocument, unpackDocumentSnapshot, type PresentationFiling } from "./document-presentation";
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
              if (table === documents) {
                const index = state.documents.findIndex((item) => item.cik === row.cik && item.accessionNo === row.accessionNo && item.docName === row.docName);
                if (index >= 0) state.documents[index] = { ...state.documents[index], ...row };
                else state.documents.push(row);
              } else {
                const index = state.filings.findIndex((item) => item.cik === row.cik && item.accessionNo === row.accessionNo);
                if (index >= 0) state.filings[index] = { ...state.filings[index], ...row };
                else state.filings.push(row);
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
