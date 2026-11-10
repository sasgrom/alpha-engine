import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OPERATION_JOB_MAP } from "../../contracts/operations";
import { operationChain } from "./operations-scheduler";
import {
  assertLocalFactsIngestUrl,
  dedupeFactsUniverse,
  factsUniverseSha256,
  factsManifestPath,
  runFactsCollection,
  type FactsCollectionOptions,
  type FactsManifestEntry,
} from "./facts-incremental";
import { sha256Text } from "./fred";
import { loadEdgarUniverse, type EdgarFiling } from "./edgar";
import { GICS_BY_TICKER, GICS_CIK_VERIFIED_ON, GICS_SNAPSHOT_AS_OF } from "../../api/services/gics-snapshot";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "alpha-facts-incremental-"));
  dirs.push(dir);
  return dir;
};

const CIK = 320193;
const NOW = "2025-06-01T00:00:00.000Z";
const OLD = "2025-01-01T00:00:00.000Z";
const filing = (form: string, accessionNo: string, filingDate = "2025-05-10"): EdgarFiling => ({ accessionNo, form, filingDate, reportDate: "2025-03-31", primaryDoc: "report.htm", eventTs: `${filingDate} 00:00:00` });
const payload = (cik: number) => ({
  cik,
  facts: {
    "us-gaap": {
      Assets: { units: { USD: [{ end: "2025-03-31", val: 100, form: "10-Q", filed: "2025-05-10", accn: "a1" }] } },
    },
  },
});

function seedSuccess(cik: number, root: string, signature: string, overrides: Partial<FactsManifestEntry> = {}) {
  const data = payload(cik);
  writeFileSync(path.join(root, `${cik}.json`), JSON.stringify(data));
  const entry: FactsManifestEntry = {
    cik,
    ticker: `T${cik}`,
    lastCheckedAt: OLD,
    lastSuccessfulCapture: OLD,
    lastSuccessfulIngest: OLD,
    lastRelevantAccession: "a1",
    lastRelevantFilingDate: "2025-05-10",
    lastRelevantForm: "10-Q",
    lastRelevantSignature: signature === "a1" ? "a1|2025-05-10|10-Q" : signature,
    lastFullReconciliation: "2025-05-30T00:00:00.000Z",
    rawSha256: sha256Text(JSON.stringify(data)),
    status: "unchanged",
    error: null,
    universeHash: "test-universe",
    ...overrides,
  };
  mkdirSync(path.dirname(factsManifestPath(root, cik)), { recursive: true });
  writeFileSync(factsManifestPath(root, cik), JSON.stringify(entry));
  return entry;
}

function options(root: string, filings: EdgarFiling[], payloads: Record<number, any> = {}): FactsCollectionOptions & { downloads: number[]; ingests: number[] } {
  const downloads: number[] = [];
  const ingests: number[] = [];
  return {
    cacheRoot: root,
    now: () => new Date(NOW),
    listFilings: async () => filings,
    companyFacts: async (cik) => { downloads.push(cik); return payloads[cik] ?? payload(cik); },
    postFactsSnapshot: async (cik) => { ingests.push(cik); return { replaced: 1 }; },
    ingestUrl: "http://127.0.0.1:3000/api/worker/ingest",
    downloads,
    ingests,
  };
}

const company = (cik = CIK, ticker = `T${cik}`) => ({ cik, ticker, name: ticker });

describe("incremental companyfacts collection", () => {
  it("skips an unchanged company without downloading or ingesting", async () => {
    const root = tempDir();
    seedSuccess(CIK, root, "a1");
    const opts = options(root, [filing("10-Q", "a1")]);
    const result = await runFactsCollection([company()], opts);
    expect(result).toMatchObject({ checked: 1, refreshed: 0, unchanged: 1, failed: 0 });
    expect(opts.downloads).toHaveLength(0);
    expect(opts.ingests).toHaveLength(0);
  });

  it("refreshes a new 10-Q and a new amendment", async () => {
    for (const form of ["10-Q", "10-Q/A"]) {
      const root = tempDir();
      seedSuccess(CIK, root, "a1");
      const opts = options(root, [filing(form, "a2")]);
      const result = await runFactsCollection([company()], opts);
      expect(result).toMatchObject({ refreshed: 1, unchanged: 0, failed: 0 });
      expect(opts.downloads).toEqual([CIK]);
      expect(opts.ingests).toEqual([CIK]);
      const manifest = JSON.parse(readFileSync(factsManifestPath(root, CIK), "utf8"));
      expect(manifest.lastRelevantAccession).toBe("a2");
      expect(manifest.lastRelevantForm).toBe(form);
    }
  });

  it("does not refresh for an irrelevant Form 4", async () => {
    const root = tempDir();
    seedSuccess(CIK, root, "");
    const opts = options(root, [filing("4", "form-4")]);
    const result = await runFactsCollection([company()], opts);
    expect(result.unchanged).toBe(1);
    expect(opts.downloads).toHaveLength(0);
  });

  it("backfills missing raw and treats corrupt raw as unsuccessful", async () => {
    const missing = tempDir();
    const opts = options(missing, [filing("10-Q", "a1")]);
    expect((await runFactsCollection([company()], opts)).refreshed).toBe(1);
    const corrupt = tempDir();
    seedSuccess(CIK, corrupt, "a1");
    writeFileSync(path.join(corrupt, `${CIK}.json`), "{not-json");
    const corruptOpts = options(corrupt, [filing("10-Q", "a1")]);
    expect((await runFactsCollection([company()], corruptOpts)).refreshed).toBe(1);
  });

  it("retries a failed previous ingest on the next run", async () => {
    const root = tempDir();
    seedSuccess(CIK, root, "a1", { status: "failed", error: "previous failure" });
    const opts = options(root, [filing("10-Q", "a1")]);
    const result = await runFactsCollection([company()], opts);
    expect(result.refreshed).toBe(1);
    expect(opts.ingests).toEqual([CIK]);
  });

  it("preserves previous good raw and success timestamps after a failed new download", async () => {
    const root = tempDir();
    const before = seedSuccess(CIK, root, "a1");
    const rawBefore = readFileSync(path.join(root, `${CIK}.json`), "utf8");
    const opts = options(root, [filing("10-Q", "a2")]);
    opts.companyFacts = async () => { throw new Error("mocked SEC failure"); };
    const result = await runFactsCollection([company()], opts);
    expect(result.failed).toBe(1);
    expect(readFileSync(path.join(root, `${CIK}.json`), "utf8")).toBe(rawBefore);
    const manifest = JSON.parse(readFileSync(factsManifestPath(root, CIK), "utf8"));
    expect(manifest.status).toBe("failed");
    expect(manifest.lastSuccessfulCapture).toBe(before.lastSuccessfulCapture);
    expect(manifest.lastSuccessfulIngest).toBe(before.lastSuccessfulIngest);
    expect(manifest.rawSha256).toBe(before.rawSha256);
  });

  it("deduplicates share classes and downloads each CIK once", async () => {
    const root = tempDir();
    const opts = options(root, [filing("10-Q", "a1")]);
    const result = await runFactsCollection([company(CIK, "GOOG"), company(CIK, "GOOGL")], opts);
    expect(result.checked).toBe(1);
    expect(opts.downloads).toEqual([CIK]);
    expect(dedupeFactsUniverse([company(CIK, "GOOG"), company(CIK, "GOOGL")])).toHaveLength(1);
  });

  it("resumes completed progress after interruption", async () => {
    const root = tempDir();
    const other = 1045810;
    const opts = options(root, [filing("10-Q", "a1")]);
    opts.companyFacts = async (cik) => {
      if (cik === other) throw new Error("interrupted");
      return payload(cik);
    };
    expect((await runFactsCollection([company(), company(other)], opts)).failed).toBe(1);
    const second = options(root, [filing("10-Q", "a1")]);
    const result = await runFactsCollection([company(), company(other)], second);
    expect(result).toMatchObject({ refreshed: 1, unchanged: 1, failed: 0 });
    expect(second.downloads).toEqual([other]);
  });

  it("runs full reconciliation only after the CIK-specific interval", async () => {
    const root = tempDir();
    seedSuccess(1, root, "a1", { lastFullReconciliation: "2025-05-20T00:00:00.000Z" });
    const opts = options(root, [filing("10-Q", "a1")]);
    expect((await runFactsCollection([company(1)], opts)).refreshed).toBe(1);
    const notDueRoot = tempDir();
    seedSuccess(CIK, notDueRoot, "a1", { lastFullReconciliation: "2025-05-20T00:00:00.000Z" });
    const notDue = options(notDueRoot, [filing("10-Q", "a1")]);
    expect((await runFactsCollection([company()], notDue)).unchanged).toBe(1);
  });

  it("keeps an S&P failure outside the research-50 dependency chain", () => {
    expect(OPERATION_JOB_MAP["sp500-facts-daily"].dependsOn).toEqual([]);
    expect(operationChain("research-factors").map((job) => job.id)).toEqual(["facts-fetch-daily", "research-series", "research-factors"]);
  });

  it("rejects a production ingest URL before collection", () => {
    expect(() => assertLocalFactsIngestUrl("https://production.invalid/api/worker/ingest")).toThrow("local-first requires a local INGEST_URL");
  });

  it("pins the documented S&P snapshot and deterministic CIK dedupe", () => {
    const rows = loadEdgarUniverse("edgar-universe.json");
    expect(GICS_SNAPSHOT_AS_OF).toBe("2026-10-11");
    expect(rows).toHaveLength(502);
    expect(dedupeFactsUniverse(rows)).toHaveLength(499);
    expect(factsUniverseSha256(rows)).toBe("cede4a6dfb3b3f20aecf08bd60ed7cad634e6ac146bfa8d6089cd4ba3a6a28ac");
    expect(GICS_CIK_VERIFIED_ON).toBe("2026-11-04");
    expect(Object.fromEntries(["TGT", "HAS", "WELL", "PH", "TROW", "TPR"].map((ticker) => [ticker, GICS_BY_TICKER.get(ticker)?.cik]))).toEqual({
      TGT: 27419,
      HAS: 46080,
      WELL: 766704,
      PH: 76334,
      TROW: 1113169,
      TPR: 1116132,
    });
    const byCik = new Map<number, string[]>();
    for (const row of rows) byCik.set(row.cik, [...(byCik.get(row.cik) ?? []), row.ticker]);
    expect([...byCik.values()].filter((tickers) => tickers.length > 1)).toHaveLength(3);
  });
});
