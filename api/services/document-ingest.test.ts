import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { documents, filings, workerKeys } from "@db/schema";
import { ingestDocumentsSnapshot, workerDocumentsSnapshotBodyZ } from "./document-ingest";
import { verifyWorkerKey } from "./worker";
import { snapshotDocument, type PresentationFiling } from "../../worker/lib/document-presentation";

const mocks = vi.hoisted(() => ({
  documents: [] as any[],
  filings: [] as any[],
  keys: [] as any[],
}));

function upsert(table: unknown, row: any) {
  if (table === documents) {
    const index = mocks.documents.findIndex((item) => item.cik === row.cik && item.accessionNo === row.accessionNo && item.docName === row.docName);
    if (index >= 0) mocks.documents[index] = { ...mocks.documents[index], ...row };
    else mocks.documents.push(row);
  } else if (table === filings) {
    const index = mocks.filings.findIndex((item) => item.cik === row.cik && item.accessionNo === row.accessionNo);
    if (index >= 0) mocks.filings[index] = { ...mocks.filings[index], ...row };
    else mocks.filings.push(row);
  } else if (table === workerKeys) mocks.keys.push(row);
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

function uploadRecorder() {
  const calls: { fileName: string; bytes: number }[] = [];
  return {
    calls,
    uploadFile: async ({ fileContent, fileName }: { fileContent: Uint8Array; fileName: string; contentType?: string }) => {
      calls.push({ fileName, bytes: fileContent.length });
      return { key: `stored:${fileName}` };
    },
  };
}

beforeEach(() => {
  mocks.documents = [];
  mocks.filings = [];
  mocks.keys = [];
});

describe("documentsSnapshot production ingest", () => {
  it("validates raw SHA256, stores canonical keys and upserts exact keys without SEC requests", async () => {
    const raw = Buffer.from("<html><body><h1>Annual report</h1></body></html>");
    const row = snapshotDocument(filing, raw);
    expect(workerDocumentsSnapshotBodyZ.parse({ kind: "documentsSnapshot", rows: [row] }).kind).toBe("documentsSnapshot");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const recorder = uploadRecorder();
    await ingestDocumentsSnapshot([row], { uploadFile: recorder.uploadFile });
    await ingestDocumentsSnapshot([row], { uploadFile: recorder.uploadFile });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.documents).toHaveLength(1);
    expect(mocks.documents[0].sha256).toBe(row.sha256);
    expect(mocks.documents[0].storageKey).toBe(`stored:CIK0000320193/000032019326000001/aapl-20251231.htm`);
    expect(mocks.documents[0].textKey).toBe(`stored:CIK0000320193/000032019326000001/aapl-20251231.htm.txt`);
    expect(mocks.filings).toHaveLength(1);
    expect(recorder.calls).toHaveLength(4);
    expect(recorder.calls[0].bytes).toBe(raw.length);
    expect(recorder.calls[1].bytes).toBe(row.plaintext.length);
    vi.unstubAllGlobals();
  });

  it("rejects a raw hash mismatch before storage and preserves existing documents", async () => {
    const row = snapshotDocument(filing, Buffer.from("<p>raw</p>"));
    mocks.documents.push({ cik: 1, accessionNo: "existing", docName: "keep.htm" });
    const recorder = uploadRecorder();
    await expect(ingestDocumentsSnapshot([{ ...row, sha256: "0".repeat(64) }], { uploadFile: recorder.uploadFile })).rejects.toThrow("SHA256 mismatch");
    expect(recorder.calls).toHaveLength(0);
    expect(mocks.documents).toHaveLength(1);
    expect(mocks.documents[0].docName).toBe("keep.htm");
  });

  it("rejects incorrect worker authorization", async () => {
    const goodKey = "good-test-key";
    mocks.keys.push({ id: 1, keyHash: createHash("sha256").update(goodKey).digest("hex"), label: "test", revokedAt: null });
    expect(await verifyWorkerKey(`Bearer ${goodKey}`)).toBe("test");
    expect(await verifyWorkerKey("Bearer wrong-key")).toBeNull();
    expect(await verifyWorkerKey(null)).toBeNull();
  });
});
