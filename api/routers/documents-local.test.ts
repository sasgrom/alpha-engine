import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";

const { readWorkerCacheDocMock } = vi.hoisted(() => ({ readWorkerCacheDocMock: vi.fn() }));
vi.mock("./document-cache", () => ({
  readWorkerCacheDoc: readWorkerCacheDocMock,
}));

const documentRow: any = {
  id: 1,
  cik: 1326801,
  accessionNo: "0001628280-26-003942",
  form: "10-K",
  docName: "meta-20251231.htm",
  storageKey: null,
  textKey: null,
};

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [documentRow] }),
      }),
    }),
  }),
}));

vi.mock("../lib/storage", () => ({
  storage: {
    readFile: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    getPresignedUrl: vi.fn(async () => ({ url: "https://storage.example/document" })),
  },
}));

const caller = appRouter.createCaller({
  req: new Request("http://127.0.0.1/"),
  resHeaders: new Headers(),
  viewAsUserId: null,
  user: { id: 1, role: "admin" } as any,
});

beforeEach(() => {
  documentRow.storageKey = null;
  documentRow.textKey = null;
  readWorkerCacheDocMock.mockReset();
  readWorkerCacheDocMock.mockReturnValue(null);
});

describe("metadata-only Documents API fallbacks", () => {
  it("returns a canonical SEC Archives rawUrl without object storage", async () => {
    const result = await caller.documents.rawUrl({ id: 1 });
    expect(result.url).toBe("https://www.sec.gov/Archives/edgar/data/1326801/000162828026003942/meta-20251231.htm");
  });

  it("returns a SEC text fallback when textKey is null", async () => {
    const result = await caller.documents.text({ id: 1, maxChars: 100 });
    expect(result.source).toBe("sec");
    expect(result.secUrl).toBe("https://www.sec.gov/Archives/edgar/data/1326801/000162828026003942/meta-20251231.htm");
    expect(result.excerpt).toBe("");
  });

  it("preserves local-cache plaintext when textKey exists but storage is unavailable", async () => {
    documentRow.textKey = "local-text-key";
    readWorkerCacheDocMock.mockReturnValue("<html><body>Independent local fixture text</body></html>");
    const result = await caller.documents.text({ id: 1, maxChars: 100 });
    expect(result.source).toBe("local-cache");
    expect(result.excerpt).toContain("Independent local fixture text");
  });
});
