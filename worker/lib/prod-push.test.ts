import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertOperationalServerEvidence, buildDailyPricesFromRaw, buildMacroPointsPayload, buildReportFileBackfillPayload, buildReportFilePayload, postOperationalIngest, prodIngestTarget, runOperationalBackfill, wholeSecondIso, shouldPushOperationalJob } from "./prod-push";
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
  vi.restoreAllMocks();
  delete process.env.INGEST_URL;
  delete process.env.PROD_INGEST_URL;
  delete process.env.WORKER_KEY;
});

describe("operational production push", () => {
  it("refuses INGEST_URL when PROD_INGEST_URL is missing", () => {
    process.env.INGEST_URL = "http://127.0.0.1:3000/api/worker/ingest";
    delete process.env.PROD_INGEST_URL;
    expect(() => prodIngestTarget()).toThrow("PROD_INGEST_URL is required (https .../api/worker/ingest); INGEST_URL is not used by prod-push");
  });

  it("requires HTTPS and the exact production ingest path", () => {
    process.env.PROD_INGEST_URL = "http://example.test/api/worker/ingest";
    expect(() => prodIngestTarget()).toThrow("PROD_INGEST_URL is required");
    process.env.PROD_INGEST_URL = "https://example.test/api/worker/other";
    expect(() => prodIngestTarget()).toThrow("PROD_INGEST_URL is required");
    process.env.PROD_INGEST_URL = "https://example.test/api/worker/ingest";
    expect(prodIngestTarget()).toEqual({ url: "https://example.test/api/worker/ingest", host: "example.test" });
  });

  it("pushes only successful scheduled outputs, never failed or manual jobs", () => {
    expect(shouldPushOperationalJob("schwab-fetch-daily", "done", "cron")).toBe(true);
    expect(shouldPushOperationalJob("macro-fred-weekly", "done", "dependency")).toBe(true);
    expect(shouldPushOperationalJob("weekly-coverage-report", "done", "dependency")).toBe(true);
    expect(shouldPushOperationalJob("form4-export", "done", "dependency")).toBe(true);
    expect(shouldPushOperationalJob("form4-export", "done", "manual")).toBe(false);
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
      { datetime: Date.parse("2026-11-09T00:00:00Z"), open: 105, high: 112, low: 104, close: 110, volume: 1100 },
      { datetime: Date.parse("2026-11-09T01:00:00Z"), open: 105, high: 112, low: 104, close: 110, volume: 1050 },
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
    const afterClose = buildDailyPricesFromRaw({ root, universeFile, now: new Date("2026-11-10T01:00:00Z") });
    expect(afterClose.rows).toHaveLength(2);
    expect(afterClose.rows[1]).toMatchObject({ date: "2026-11-09", close: 110, volume: 1050 });
    expect(JSON.parse(afterClose.report.body).companies[0].conflictEvidence).toEqual({
      date: "2026-11-09",
      candidates: [
        { volume: 1100, fetchedAt: "2026-11-09T00:00:00.000Z" },
        { volume: 1050, fetchedAt: "2026-11-09T01:00:00.000Z" },
      ],
      selected: { volume: 1050, fetchedAt: "2026-11-09T01:00:00.000Z" },
    });
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
    process.env.PROD_INGEST_URL = "https://example.test/api/worker/ingest";
    process.env.WORKER_KEY = "unit-test-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporary failure", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify({ generatedAt: "2026-11-09T10:00:00.000Z" });
    const onTarget = vi.fn();
    const response = await postOperationalIngest({ kind: "reportFile", name: "schwab-context.json", body, sha256: createHash("sha256").update(body).digest("hex"), generatedAt: "2026-11-09T10:00:00.000Z" }, { onTarget });
    expect(response).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onTarget).toHaveBeenCalledWith("example.test");
  });

  it("rounds .500+ timestamps to the next second before sending payloads", async () => {
    expect(wholeSecondIso("2026-11-10T12:00:00.499Z")).toBe("2026-11-10T12:00:00.000Z");
    expect(wholeSecondIso("2026-11-10T12:00:00.500Z")).toBe("2026-11-10T12:00:01.000Z");
    process.env.PROD_INGEST_URL = "https://example.test/api/worker/ingest";
    process.env.WORKER_KEY = "unit-test-key";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await postOperationalIngest({ kind: "pricesDaily", generatedAt: "2026-11-10T12:00:00.500Z", rows: [{ fetchedAt: "2026-11-10T12:00:00.501Z" }] });
    const wire = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(wire.generatedAt).toBe("2026-11-10T12:00:01.000Z");
    expect(wire.rows[0].fetchedAt).toBe("2026-11-10T12:00:01.000Z");
  });

  it("rejects an old server lane without emitting a success line", async () => {
    process.env.PROD_INGEST_URL = "https://example.test/api/worker/ingest";
    process.env.WORKER_KEY = "unit-test-key";
    const response = new Response(JSON.stringify({ error: "unsupported kind" }), { status: 400, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(postOperationalIngest({ kind: "unsupported" })).rejects.toThrow("prod server has no ingest lane yet — publish the new version first");
    expect(log.mock.calls.some(([line]) => String(line).startsWith("PROD_PUSH_OK"))).toBe(false);
  });

  it("summarizes only server evidence and rejects failed post-checks", () => {
    const summary = assertOperationalServerEvidence([{ accepted: 2, dupes: 1, postCheck: { expected: 3, verified: 3, failed: 0 } }]);
    expect(summary).toEqual({ accepted: 2, dupes: 1, rejected: 0, postCheck: { expected: 3, verified: 3, failed: 0 } });
    expect(() => assertOperationalServerEvidence({ accepted: 0, dupes: 0, postCheck: { expected: 1, verified: 0, failed: 1 } })).toThrow("Server post-check failed");
  });

  it("backfills signals and digests idempotently with bounded batches", async () => {
    process.env.PROD_INGEST_URL = "https://example.test/api/worker/ingest";
    process.env.WORKER_KEY = "unit-test-key";
    let duplicate = false;
    const fetchMock = vi.fn(async (_url: string, options: any) => {
      const payload = JSON.parse(options.body);
      return new Response(JSON.stringify({
        accepted: duplicate ? 0 : payload.rows.length,
        dupes: duplicate ? payload.rows.length : 0,
        skippedDupes: duplicate ? payload.rows.length : 0,
        upserted: duplicate ? 0 : payload.rows.length,
        postCheck: { expected: payload.rows.length, verified: payload.rows.length, failed: 0 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const signals = Array.from({ length: 501 }, (_, index) => ({ cik: index + 1, source: "edgar", signalType: "tone", eventTs: "2026-11-01 00:00:00", payloadKey: `s${index}`, src: "live" }));
    const firstSignals = await runOperationalBackfill({ kind: "signals", rows: signals });
    expect(assertOperationalServerEvidence(firstSignals)).toMatchObject({ accepted: 501, dupes: 0, postCheck: { expected: 501, verified: 501 } });
    duplicate = true;
    const retrySignals = await runOperationalBackfill({ kind: "signals", rows: signals });
    expect(assertOperationalServerEvidence(retrySignals)).toMatchObject({ accepted: 0, dupes: 501, postCheck: { expected: 501, verified: 501 } });
    const digests = Array.from({ length: 11 }, (_, index) => ({ kind: "morning", scope: "", forDate: `2026-11-${String(index + 1).padStart(2, "0")}`, body: "brief", model: null, meta: null }));
    duplicate = false;
    await runOperationalBackfill({ kind: "digests", rows: digests });
    duplicate = true;
    const retryDigests = await runOperationalBackfill({ kind: "digests", rows: digests });
    expect(assertOperationalServerEvidence(retryDigests)).toMatchObject({ accepted: 0, dupes: 11, postCheck: { expected: 11, verified: 11 } });
    expect(fetchMock.mock.calls.filter(([, options]: any) => JSON.parse(options.body).kind === "signals").every(([, options]: any) => JSON.parse(options.body).rows.length <= 500)).toBe(true);
    expect(fetchMock.mock.calls.filter(([, options]: any) => JSON.parse(options.body).kind === "digests").every(([, options]: any) => JSON.parse(options.body).rows.length <= 10)).toBe(true);
  });

  it("compresses a full universe-50 Form 4 report without dropping transactions", () => {
    const body = JSON.stringify({
      status: "full_run",
      generatedAt: "2026-11-10T12:00:00.000Z",
      universe: 50,
      totals: { accessions: 1, transactions: 1, clusters: 1 },
      transactions: [{ accessionNo: "0000000001-26-000001" }],
      clusters: [{ clusterId: "cluster-1" }],
    });
    const payload = buildReportFilePayload("insider-form4.json", { body });
    expect(payload).toMatchObject({ kind: "reportFile", name: "insider-form4.json", contentEncoding: "gzip-base64" });
    expect(payload.sha256).toBe(createHash("sha256").update(payload.body).digest("hex"));
    expect(JSON.parse(gunzipSync(Buffer.from(payload.body.slice("gzip-base64:".length), "base64")).toString("utf8"))).toEqual(JSON.parse(body));
    expect(() => buildReportFilePayload("insider-form4.json", { body: JSON.stringify({ status: "preview_sample", generatedAt: "2026-11-10T12:00:00.000Z", universe: 50 }) })).toThrow("full universe-50");
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
