import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { documents, filings, workerKeys } from "@db/schema";
import { ingestDocumentsSnapshot, workerDocumentsSnapshotBodyZ } from "./document-ingest";
import { verifyWorkerKey } from "./worker";
import { metadataDocument, snapshotDocument, type PresentationFiling } from "../../worker/lib/document-presentation";

const mocks = vi.hoisted(() => ({
  documents: [] as any[],
  filings: [] as any[],
  keys: [] as any[],
}));

function upsert(table: unknown, row: any) {
  for (const item of Array.isArray(row) ? row : [row]) {
    if (table === documents) {
      const index = mocks.documents.findIndex((existing) => existing.cik === item.cik && existing.accessionNo === item.accessionNo && existing.docName === item.docName);
      if (index >= 0) mocks.documents[index] = { ...mocks.documents[index], ...item };
      else mocks.documents.push(item);
    } else if (table === filings) {
      const index = mocks.filings.findIndex((existing) => existing.cik === item.cik && existing.accessionNo === item.accessionNo);
      if (index >= 0) mocks.filings[index] = { ...mocks.filings[index], ...item };
      else mocks.filings.push(item);
    } else if (table === workerKeys) mocks.keys.push(item);
  }
}

function textOf(value: unknown, seen = new WeakSet<object>()): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);
  return Object.values(value).map((item) => textOf(item, seen)).join(" ");
}

const db = {
  insert(table: unknown) {
    return { values: (row: any) => ({ onDuplicateKeyUpdate: async () => upsert(table, row) }) };
  },
  select() {
    return {
      from(table: unknown) {
        return {
          where: (condition: unknown) => ({
            limit: async (limit: number) => {
              if (table === documents) return mocks.documents.filter((doc) => textOf(condition).includes(doc.docName)).slice(0, limit);
              const text = textOf(condition);
              return mocks.keys.filter((row) => text.includes(row.keyHash)).slice(0, limit);
            },
          }),
        };
      },
    };
  },
  update() {
    return { set: () => ({ where: async () => undefined }) };
  },
};
vi.mock("../queries/connection", () => ({ getDb: () => db }));

const filing: PresentationFiling = {
  cik: 320193,
  accessionNo: "0000320193-26-000001",
  form: "10-K",
  filingDate: "2026-02-01",
  reportDate: "2025-12-31",
  primaryDoc: "aapl-20251231.htm",
};

beforeEach(() => {
  mocks.documents = [];
  mocks.filings = [];
  mocks.keys = [];
});

describe("metadata-only documentsSnapshot production ingest", () => {
  it("upserts exact keys without object storage or SEC requests", async () => {
    const row = metadataDocument(snapshotDocument(filing, Buffer.from("<html><body><h1>Annual report</h1></body></html>")));
    expect(workerDocumentsSnapshotBodyZ.parse({ kind: "documentsSnapshot", rows: [row] }).kind).toBe("documentsSnapshot");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await ingestDocumentsSnapshot([row]);
    await ingestDocumentsSnapshot([row]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.documents).toHaveLength(1);
    expect(mocks.documents[0].sha256).toBe(row.sha256);
    expect(mocks.documents[0].storageKey).toBeNull();
    expect(mocks.documents[0].textKey).toBeNull();
    expect(mocks.documents[0].location).toBe("none");
    expect(mocks.filings).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("rejects raw payloads and preserves existing cloud documents", async () => {
    const row = metadataDocument(snapshotDocument(filing, Buffer.from("<p>raw</p>")));
    mocks.documents.push({ cik: 1, accessionNo: "existing", docName: "keep.htm", storageKey: "cloud-key", textKey: "cloud-text", location: "cloud" });
    expect(() => workerDocumentsSnapshotBodyZ.parse({ kind: "documentsSnapshot", rows: [{ ...row, rawGzipBase64: "eA==", plaintext: "raw" }] })).toThrow();
    expect(mocks.documents).toHaveLength(1);
    expect(mocks.documents[0].docName).toBe("keep.htm");
    await ingestDocumentsSnapshot([row]);
    expect(mocks.documents[0].storageKey).toBe("cloud-key");
    expect(mocks.documents[0].textKey).toBe("cloud-text");
    expect(mocks.documents[0].location).toBe("cloud");
  });

  it("accepts bounded metadata batches and rejects oversized ones", async () => {
    const first = metadataDocument(snapshotDocument(filing, Buffer.from("<p>first</p>")));
    const second = { ...first, docName: "second.htm" };
    expect(workerDocumentsSnapshotBodyZ.parse({ kind: "documentsSnapshot", rows: [first, second] }).rows).toHaveLength(2);
    await ingestDocumentsSnapshot([first, second]);
    expect(mocks.documents).toHaveLength(2);
    expect(() => workerDocumentsSnapshotBodyZ.parse({ kind: "documentsSnapshot", rows: Array.from({ length: 101 }, () => first) })).toThrow();
  });

  it("rejects incorrect worker authorization", async () => {
    const goodKey = "good-test-key";
    mocks.keys.push({ id: 1, keyHash: createHash("sha256").update(goodKey).digest("hex"), label: "test", revokedAt: null });
    expect(await verifyWorkerKey(`Bearer ${goodKey}`)).toBe("test");
    expect(await verifyWorkerKey("Bearer wrong-key")).toBeNull();
    expect(await verifyWorkerKey(null)).toBeNull();
  });
});
