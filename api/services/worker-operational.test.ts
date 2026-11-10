import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { macroPoints, prices, reports } from "@db/schema";
import { ingestMacroPoints, ingestPricesDaily, ingestReportFile, workerPriceDailyRowZ } from "./worker-operational";
import { reportFileResponse } from "./report-files";
import { workerIngestBodyZ } from "./worker";

class FakeDb {
  data = { prices: [] as any[], macro: [] as any[], reports: [] as any[] };
  private rows(table: any) {
    if (table === prices) return this.data.prices;
    if (table === macroPoints) return this.data.macro;
    if (table === reports) return this.data.reports;
    throw new Error("Unexpected table");
  }
  select() {
    return { from: (table: any) => ({ where: () => {
      const rows = this.rows(table);
      return { limit: async (count: number) => rows.slice(0, count), then: (resolve: (value: any[]) => unknown) => Promise.resolve(rows).then(resolve) };
    } }) };
  }
  insert(table: any) {
    return { values: (input: any[]) => ({ onDuplicateKeyUpdate: async () => {
      const rows = this.rows(table);
      for (const row of Array.isArray(input) ? input : [input]) {
        const key = table === prices ? `${row.cik}|${row.date}|${row.source}` : table === macroPoints ? `${row.seriesId}|${row.date}|${row.realtimeStart}` : row.name;
        const index = rows.findIndex((current) => (table === prices ? `${current.cik}|${current.date}|${current.source}` : table === macroPoints ? `${current.seriesId}|${current.date}|${current.realtimeStart}` : current.name) === key);
        const stored = table === reports ? { ...row, generatedAt: new Date(Math.floor(new Date(row.generatedAt).getTime() / 1000) * 1000) } : row;
        if (index >= 0) rows[index] = stored;
        else rows.push(stored);
      }
    } }) };
  }
}

const price = (overrides: Record<string, unknown> = {}) => ({
  cik: 320193,
  ticker: "AAPL",
  date: "2026-11-06",
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  adjClose: null,
  volume: 1000,
  source: "schwab" as const,
  fetchedAt: "2026-11-07T01:00:00.123Z",
  ...overrides,
});
const macro = (overrides: Record<string, unknown> = {}) => ({
  seriesId: "DGS10",
  observationPeriod: "2026-11-01",
  realtimeStart: "2026-11-06",
  realtimeEnd: null,
  value: 4.1,
  sourceHash: "a".repeat(64),
  ...overrides,
});

let db: FakeDb;
let temp: string;
beforeEach(() => {
  db = new FakeDb();
  temp = mkdtempSync(path.join(tmpdir(), "operational-reports-"));
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

describe("operational worker ingest", () => {
  it("post-check survives mysql2-shaped Date and BIGINT volume values", async () => {
    const dayKey = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    const store: any[] = [];
    const db: any = {
      select: () => ({ from: () => ({ where: () => ({
        limit: async (n: number) => store.slice(0, n),
        then: (resolve: (v: any[]) => unknown) => Promise.resolve(store.map((r) => ({ ...r }))).then(resolve),
      }) }) }),
      insert: () => ({ values: (input: any[]) => ({ onDuplicateKeyUpdate: async () => {
        for (const row of input) {
          const i = store.findIndex((c) => c.cik === row.cik && dayKey(c.date) === dayKey(row.date) && c.source === row.source);
          const stored = { ...row, date: new Date(`${dayKey(row.date)}T00:00:00Z`), fetchedAt: new Date(Math.floor(new Date(row.fetchedAt).getTime() / 1000) * 1000), volume: String(row.volume) };
          if (i >= 0) store[i] = stored; else store.push(stored);
        }
      } }) }),
    };
    await ingestPricesDaily([price()], { db });
    const second = await ingestPricesDaily([price()], { db });
    expect(second.dupes).toBe(1);
    expect(second.postCheck.verified).toBe(1);
    expect(store).toHaveLength(1);
  });

  it("macro vintage post-check survives driver-shaped date rows", async () => {
    const dayKey = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    const store: any[] = [];
    const db: any = {
      select: () => ({ from: () => ({ where: () => ({
        limit: async (n: number) => store.slice(0, n),
        then: (resolve: (v: any[]) => unknown) => Promise.resolve(store.map((r) => ({ ...r }))).then(resolve),
      }) }) }),
      insert: () => ({ values: (input: any[]) => ({ onDuplicateKeyUpdate: async () => {
        for (const row of input) {
          const i = store.findIndex((c) => c.seriesId === row.seriesId && dayKey(c.date) === dayKey(row.date) && dayKey(c.realtimeStart) === dayKey(row.realtimeStart));
          const stored = { ...row, date: new Date(`${dayKey(row.date)}T00:00:00Z`), realtimeStart: new Date(`${dayKey(row.realtimeStart)}T00:00:00Z`), realtimeEnd: null };
          if (i >= 0) store[i] = stored; else store.push(stored);
        }
      } }) }),
    };
    await ingestMacroPoints([macro()], { db });
    const second = await ingestMacroPoints([macro()], { db });
    expect(second.dupes).toBe(1);
    expect(second.postCheck.verified).toBe(1);
    expect(store).toHaveLength(1);
  });

  it("validates OHLC, future dates and source whitelist", async () => {
    expect(() => workerPriceDailyRowZ.parse(price({ low: 120 }))).toThrow("OHLC sanity");
    expect(() => workerPriceDailyRowZ.parse(price({ source: "yahoo" }))).toThrow();
    await expect(ingestPricesDaily([price({ date: "2026-11-08" })], { db, now: new Date("2026-11-07T12:00:00Z") })).rejects.toThrow("Future price date");
    expect(db.data.prices).toHaveLength(0);
  });

  it("upserts exact price keys and makes identical retries dupes", async () => {
    const first = await ingestPricesDaily([price()], { db });
    expect(first).toMatchObject({ accepted: 1, dupes: 0, postCheck: { expected: 1, verified: 1 } });
    const second = await ingestPricesDaily([price()], { db });
    expect(second).toMatchObject({ accepted: 0, dupes: 1, postCheck: { expected: 1, verified: 1 } });
    expect(db.data.prices).toHaveLength(1);
    const changed = await ingestPricesDaily([price({ close: 106 })], { db });
    expect(changed.accepted).toBe(1);
    expect(db.data.prices[0].close).toBe(106);
  });

  it("rejects conflicting exact price keys before writing", async () => {
    await expect(ingestPricesDaily([price(), price({ close: 106 })], { db })).rejects.toThrow("Conflicting pricesDaily exact key");
    expect(db.data.prices).toHaveLength(0);
  });

  it("accepts all new kinds in the shared worker body contract", () => {
    expect(workerIngestBodyZ.parse({ kind: "pricesDaily", rows: [price()] }).kind).toBe("pricesDaily");
    expect(workerIngestBodyZ.parse({ kind: "macroPoints", rows: [macro()] }).kind).toBe("macroPoints");
    const body = JSON.stringify({ generatedAt: "2026-11-09T10:00:00.000Z" });
    expect(workerIngestBodyZ.parse({ kind: "reportFile", name: "schwab-context.json", body, sha256: createHash("sha256").update(body).digest("hex"), generatedAt: "2026-11-09T10:00:00.000Z" }).kind).toBe("reportFile");
  });

  it("upserts macro exact keys and refuses vintage content overwrite", async () => {
    const first = await ingestMacroPoints([macro()], { db });
    expect(first).toMatchObject({ accepted: 1, dupes: 0, postCheck: { expected: 1, verified: 1 } });
    const retry = await ingestMacroPoints([macro()], { db });
    expect(retry).toMatchObject({ accepted: 0, dupes: 1 });
    const conflict = await ingestMacroPoints([macro({ value: 4.2 })], { db });
    expect(conflict.rejected[0].reason).toContain("overwrite refused");
    expect(db.data.macro).toHaveLength(1);
    expect(db.data.macro[0].value).toBe(4.1);
  });

  it("rejects an older open vintage that overlaps a newer realtimeStart", async () => {
    const result = await ingestMacroPoints([macro({ realtimeStart: "2026-11-06" }), macro({ realtimeStart: "2026-11-01" })], { db });
    expect(result.rejected.some((row: any) => row.key.includes("2026-11-01"))).toBe(true);
    expect(db.data.macro).toHaveLength(1);
  });

  it("stores newer report content and verifies hashes with second-precision database timestamps", async () => {
    const body = JSON.stringify({ generatedAt: "2026-11-09T10:00:00.123Z", value: 1 });
    const input = { name: "schwab-context.json", body, sha256: createHash("sha256").update(body).digest("hex"), generatedAt: "2026-11-09T10:00:00.123Z" };
    expect((await ingestReportFile(input, { db })).accepted).toBe(1);
    expect((await ingestReportFile({ ...input, generatedAt: "2026-11-08T10:00:00.000Z" }, { db })).dupes).toBe(1);
    expect(db.data.reports).toHaveLength(1);
    await expect(ingestReportFile({ ...input, sha256: "0".repeat(64) }, { db })).rejects.toThrow("SHA256 mismatch");
    await expect(ingestReportFile({ ...input, name: "not-allowed.json" }, { db })).rejects.toThrow("not whitelisted");
  });

  it("serves DB reports only when fresher than static and exposes actual generatedAt", async () => {
    const name = "schwab-context.json";
    const staticBody = JSON.stringify({ generatedAt: "2026-11-09T10:00:00.000Z", source: "static" });
    writeFileSync(path.join(temp, name), staticBody);
    const dbBody = JSON.stringify({ generatedAt: "2026-11-09T11:00:00.000Z", source: "database" });
    db.data.reports.push({ name, body: dbBody, sha256: createHash("sha256").update(dbBody).digest("hex"), generatedAt: new Date("2026-11-09T11:00:00.000Z") });
    const fromDb = await reportFileResponse(name, { db, staticRoot: temp });
    expect(fromDb.headers.get("x-report-source")).toBe("database");
    expect(fromDb.headers.get("x-report-generated-at")).toBe("2026-11-09T11:00:00.000Z");
    expect(await fromDb.text()).toBe(dbBody);
    writeFileSync(path.join(temp, name), JSON.stringify({ generatedAt: "2026-11-09T12:00:00.000Z", source: "static" }));
    const fromStatic = await reportFileResponse(name, { db, staticRoot: temp });
    expect(fromStatic.headers.get("x-report-source")).toBe("static");
    expect(fromStatic.headers.get("x-report-generated-at")).toBe("2026-11-09T12:00:00.000Z");
  });
});
