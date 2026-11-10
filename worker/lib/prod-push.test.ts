import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDailyPricesFromRaw, buildMacroPointsPayload, buildReportFileBackfillPayload, buildReportFilePayload, postOperationalIngest, shouldPushOperationalJob } from "./prod-push";
import { MACRO_SERIES } from "./macro-sources";
import type { NormalizedMacroPoint } from "./fred";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "operational-push-"));
  mkdirSync(path.join(root, "pricehistory"), { recursive: true });
  mkdirSync(path.join(root, "normalized", "fred"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
  delete process.env.INGEST_URL;
  delete process.env.WORKER_KEY;
});

describe("operational production push", () => {
  it("pushes only successful scheduled outputs, never failed or manual jobs", () => {
    expect(shouldPushOperationalJob("schwab-fetch-daily", "done", "cron")).toBe(true);
    expect(shouldPushOperationalJob("macro-fred-weekly", "done", "dependency")).toBe(true);
    expect(shouldPushOperationalJob("schwab-fetch-daily", "error", "cron")).toBe(false);
    expect(shouldPushOperationalJob("schwab-fetch-daily", "done", "manual")).toBe(false);
    expect(shouldPushOperationalJob("expectations-report", "done", "cron")).toBe(false);
  });

  it("builds exact OHLCV rows and a generated daily report without raw chains", () => {
    const universeFile = path.join(root, "universe.json");
    writeFileSync(universeFile, JSON.stringify([{ cik: 320193, ticker: "AAPL" }]));
    writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ tickers: [{ ticker: "AAPL", status: "complete", capturedAt: "2026-11-07T01:00:00.000Z" }] }));
    const candles = [
      { datetime: Date.parse("2026-11-05T00:00:00Z"), open: 99, high: 105, low: 98, close: 101, volume: 900 },
      { datetime: Date.parse("2026-11-06T00:00:00Z"), open: 100, high: 110, low: 90, close: 105, volume: 1000 },
    ];
    writeFileSync(path.join(root, "pricehistory", "AAPL.json"), JSON.stringify({ candles }));
    const result = buildDailyPricesFromRaw({ root, universeFile, now: new Date("2026-11-09T12:00:00Z") });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toMatchObject({ cik: 320193, ticker: "AAPL", date: "2026-11-06", open: 100, high: 110, low: 90, close: 105, source: "schwab" });
    const report = JSON.parse(result.report.body);
    expect(report.companies[0]).toMatchObject({ previousClose: 101, close: 105, change: 4 });
    expect(result.report.sha256).toBe(createHash("sha256").update(result.report.body).digest("hex"));
    expect(result.report.body).not.toContain("optionExpDateMap");
    const backfill = buildReportFileBackfillPayload("daily-prices-schwab.json", { root, universeFile, now: new Date("2026-11-09T12:00:00Z") });
    expect(backfill).toMatchObject({ kind: "reportFile", name: "daily-prices-schwab.json", body: result.report.body, sha256: result.report.sha256 });
    expect(buildDailyPricesFromRaw({ root, universeFile, from: "2026-11-07", now: new Date("2026-11-09T12:00:00Z") }).rows).toHaveLength(0);
  });

  it("builds macro vintage rows with availability and source hashes", () => {
    for (const definition of MACRO_SERIES) {
      const row: NormalizedMacroPoint = {
        seriesId: definition.seriesId,
        observationPeriod: "2026-11-01",
        value: 1.5,
        availableAt: "2026-11-06",
        supersededAt: null,
        sourceHash: "a".repeat(64),
      };
      writeFileSync(path.join(root, "normalized", "fred", `${definition.seriesId}.json`), JSON.stringify([row]));
    }
    const rows = buildMacroPointsPayload({ root, from: "2026-11-01" });
    expect(rows).toHaveLength(MACRO_SERIES.length);
    expect(rows[0]).toMatchObject({ observationPeriod: "2026-11-01", realtimeStart: "2026-11-06", realtimeEnd: null, sourceHash: "a".repeat(64) });
    expect(buildMacroPointsPayload({ root, from: "2026-11-07" })).toHaveLength(0);
  });

  it("uses exactly one retry before returning a successful ingest response", async () => {
    process.env.INGEST_URL = "https://example.test/api/worker/ingest";
    process.env.WORKER_KEY = "unit-test-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporary failure", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify({ generatedAt: "2026-11-09T10:00:00.000Z" });
    const response = await postOperationalIngest({ kind: "reportFile", name: "schwab-context.json", body, sha256: createHash("sha256").update(body).digest("hex"), generatedAt: "2026-11-09T10:00:00.000Z" });
    expect(response).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hashes report bodies and preserves their generatedAt", () => {
    const body = JSON.stringify({ generatedAt: "2026-11-09T10:00:00.000Z", ok: true });
    writeFileSync(path.join(root, "schwab-context.json"), body);
    const payload = buildReportFilePayload("schwab-context.json", { root });
    expect(payload.generatedAt).toBe("2026-11-09T10:00:00.000Z");
    expect(payload.sha256).toBe(createHash("sha256").update(body).digest("hex"));
    expect(JSON.parse(readFileSync(path.join(root, "schwab-context.json"), "utf8"))).toEqual({ generatedAt: "2026-11-09T10:00:00.000Z", ok: true });
  });
});
