import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchFilingDocument: vi.fn(),
  fetchDoc: vi.fn(),
  listFilingDocs: vi.fn(),
  listFilingsDetailed: vi.fn(),
  writeJsonAtomic: vi.fn(),
}));

vi.mock("./lib/edgar", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/edgar")>(),
  fetchFilingDocument: mocks.fetchFilingDocument,
  fetchDoc: mocks.fetchDoc,
  listFilingDocs: mocks.listFilingDocs,
  loadEdgarUniverse: () => [{ cik: 3570, ticker: "LNG", name: "Cheniere Energy" }],
  realCacheRoot: () => "D:/cache",
}));
vi.mock("./lib/edgar-listing", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/edgar-listing")>(),
  listFilingsDetailed: mocks.listFilingsDetailed,
}));
vi.mock("./lib/json-file", () => ({ writeJsonAtomic: mocks.writeJsonAtomic }));
vi.mock("./lib/progress", () => ({
  startProgress: () => ({ log: vi.fn(), stage: vi.fn(), item: vi.fn(), stageDone: vi.fn(), done: vi.fn() }),
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => { throw new Error("No manifest fixture"); }),
  statfsSync: vi.fn(() => ({ bavail: 16, bsize: 1024 ** 3 })),
  writeFileSync: vi.fn(),
}));

const originalArgv = process.argv;
const filing = {
  accessionNo: "0000003570-26-000123", form: "8-K", filingDate: "2026-10-01", reportDate: "2026-09-30",
  primaryDoc: "lng-20260930.htm", eventTs: "2026-10-01 13:30:00", acceptedEt: "2026-10-01T13:30:00", items: "2.02,9.01",
};
const forms = "10-K,10-K/A,10-Q,10-Q/A,8-K,8-K/A";

beforeEach(() => {
  vi.resetModules();
  mocks.listFilingsDetailed.mockReset().mockReturnValue([filing]);
  mocks.fetchFilingDocument.mockReset().mockResolvedValue({ docName: filing.primaryDoc, html: "release" });
  mocks.fetchDoc.mockReset();
  mocks.listFilingDocs.mockReset();
  mocks.writeJsonAtomic.mockReset();
  process.argv = ["node", "worker/edgar-fetch.mts", "--only", "LNG", "--forms", forms];
});

afterEach(() => { process.argv = originalArgv; });

describe("EDGAR metadata-only collection", () => {
  it("writes submission metadata without calling any document downloader", async () => {
    process.argv.push("--metadata-only");
    await import("./edgar-fetch.mts");
    expect(mocks.fetchFilingDocument).not.toHaveBeenCalled();
    expect(mocks.fetchDoc).not.toHaveBeenCalled();
    expect(mocks.listFilingDocs).not.toHaveBeenCalled();
    expect(mocks.writeJsonAtomic).toHaveBeenCalledOnce();
    expect(mocks.writeJsonAtomic.mock.calls[0][1]).toEqual([{ ...filing, docName: filing.primaryDoc, fetched: false, scored: false }]);
  });

  it("keeps the default primary-document download behavior", async () => {
    await import("./edgar-fetch.mts");
    expect(mocks.fetchFilingDocument).toHaveBeenCalledOnce();
    expect(mocks.writeJsonAtomic.mock.calls[0][1][0]).toMatchObject({ fetched: true, docName: filing.primaryDoc });
  });

  it("preserves an existing fetched flag and actual fallback document name", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify([{ ...filing, docName: "largest-exhibit.htm", fetched: true, scored: false }]));
    process.argv.push("--metadata-only");
    await import("./edgar-fetch.mts");
    expect(mocks.fetchFilingDocument).not.toHaveBeenCalled();
    expect(mocks.writeJsonAtomic.mock.calls[0][1][0]).toMatchObject({ fetched: true, docName: "largest-exhibit.htm" });
  });
});
