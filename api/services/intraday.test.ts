import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildIntradayMarket, etWallToIso, intradayMarketOpen } from "../../worker/lib/intraday-views";
import { clearIntradayCaches, readIntradayJsonFile, readStoredIntradaySession } from "../../worker/lib/intraday-storage";
import { buildBars, type IntradayQuote, type IntradaySnapshot } from "../../worker/lib/schwab-intraday";
import type { DeskSnapshot } from "@contracts/desk-snapshot";
import { intradayForCompany, readIntradayMarketReport } from "./intraday";

const SNAPSHOT = { companies: [{ ticker: "AAPL", registryTicker: "AAPL", cik: 320193, name: "Apple Inc.", sector: "Information Technology" }] } as DeskSnapshot;
const roots: string[] = [];
afterEach(() => {
  clearIntradayCaches();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function quote(last: number, previousClose: number, volume: number, delayed: boolean | null = false): IntradayQuote {
  return { last, previousClose, open: last - 0.5, high: last + 1, low: last - 1, volume, tradeTime: null, delayed };
}

function writeSession(root: string, session: string, series: Record<string, [IntradayQuote, IntradayQuote]>) {
  const folder = path.join(root, session);
  mkdirSync(folder, { recursive: true });
  const snapshots = [`${session}T14:40:00Z`, `${session}T14:45:00Z`].map((capturedAt, index): IntradaySnapshot => ({
    schemaVersion: 1, session, capturedAt,
    quotes: Object.fromEntries(Object.entries(series).map(([ticker, quotes]) => [ticker, quotes[index]])),
  }));
  snapshots.forEach((snapshot, index) => writeFileSync(path.join(folder, `${index === 0 ? "0940" : "0945"}.json`), JSON.stringify(snapshot)));
  writeFileSync(path.join(folder, "bars.json"), JSON.stringify({ schemaVersion: 1, session, intervalMinutes: 5, snapshots: 2, updatedAt: snapshots[1].capturedAt, bars: buildBars(snapshots) }));
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "intraday-api-"));
  roots.push(root);
  for (const session of ["2026-11-12", "2026-11-13"]) {
    const next = session === "2026-11-13";
    writeSession(root, session, {
      AAPL: next ? [quote(52, 51, 1000, true), quote(52.5, 51, 1500, true)] : [quote(102, 100, 2000), quote(103, 100, 2500)],
      SPY: next ? [quote(502, 500, 10000), quote(503, 500, 11000)] : [quote(500, 498, 9000), quote(501, 498, 9500)],
      XLK: next ? [quote(202, 200, 3000), quote(203, 200, 3500)] : [quote(200, 199, 2500), quote(201, 199, 2700)],
    });
  }
  return root;
}

const releases = [{
  cik: 320193, ticker: "AAPL", periodicForm: "10-Q", periodicAccession: null, periodicAcceptedEt: null,
  earningsAccession: "0000320193-26-000100", earningsAcceptedEt: "2026-11-13T10:05:00", firstPublicationEt: "2026-11-13T10:05:00",
  earningsFilings: [{ accessionNo: "0000320193-26-000100", acceptedEt: "2026-11-13T10:05:00" }],
}];

describe("desk intraday company procedure", () => {
  it("returns company, SPY and sector bars with VWAP, previous close, markers and split-adjusted history", async () => {
    const root = fixture();
    const result = await intradayForCompany({ ticker: "AAPL", sessions: 2 }, {
      root, snapshot: SNAPSHOT, adjustments: [{ ticker: "AAPL", ratio: 0.5, firstNewBasisDate: "2026-11-13" }], releases,
      filings: [{ accessionNo: "0000320193-26-000101", form: "8-K", filingDate: "2026-11-13" }], now: new Date("2026-11-13T15:10:00Z"),
    });
    expect(result).not.toBeNull();
    expect(result!.status).toBe("ok");
    expect(result!.sectorFund).toBe("XLK");
    expect(result!.sessions).toHaveLength(2);
    expect(result!.marketOpen).toBe(false);
    expect(result!.delayed).toBe(true);
    const previous = result!.sessions[0], latest = result!.sessions[1];
    expect(previous.company.splitAdjusted).toBe(true);
    expect(previous.company.previousClose).toBe(50);
    expect(previous.company.bars[0]).toMatchObject({ o: 50.75, h: 51.5, l: 50.5, c: 51, v: 4000 });
    expect(previous.spy.bars).toHaveLength(2);
    expect(previous.sector?.bars).toHaveLength(2);
    expect(latest.company.previousClose).toBe(51);
    expect(latest.company.openGap).toBeCloseTo(51.5 / 51 - 1, 10);
    expect(latest.company.vwap).toBeCloseTo((52 * 1000 + ((53.5 + 52 + 52.5) / 3) * 500) / 1500, 10);
    expect(latest.company.bars[0].vwap).toBeCloseTo(52, 10);
    expect(latest.company.bars[1].vwap).toBeCloseTo(latest.company.vwap!, 10);
    expect(latest.markers).toHaveLength(2);
    expect(latest.markers[0]).toMatchObject({ kind: "release", time: "2026-11-13T15:05:00.000Z", precision: "second" });
    expect(latest.markers[1]).toMatchObject({ kind: "8-K", time: null, date: "2026-11-13", precision: "day", label: "8-K · filing date only" });
  });

  it("returns null instead of inventing an empty company's session", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "intraday-empty-"));
    roots.push(root);
    expect(await intradayForCompany({ ticker: "AAPL", sessions: 1 }, { root, snapshot: SNAPSHOT, adjustments: [], releases: [], filings: [] })).toBeNull();
  });

  it("converts release wall times in both ET offset regimes and polls only a fresh session", () => {
    expect(etWallToIso("2026-11-13T10:05:00")).toBe("2026-11-13T15:05:00.000Z");
    expect(etWallToIso("2026-07-01T09:30:00")).toBe("2026-07-01T13:30:00.000Z");
    expect(intradayMarketOpen("2026-11-13", "2026-11-13T14:45:00Z", new Date("2026-11-13T14:50:00Z"))).toBe(true);
    expect(intradayMarketOpen("2026-11-13", "2026-11-13T14:45:00Z", new Date("2026-11-13T15:10:00Z"))).toBe(false);
  });
});

describe("intraday file cache and market summary serving", () => {
  it("re-reads changed files by time and names the last session after the market closes", async () => {
    const root = fixture(), stored = readStoredIntradaySession(root, "2026-11-13")!;
    expect(stored.previousClose.AAPL).toBe(51);
    const file = path.join(root, "cache.json");
    writeFileSync(file, "{\"value\":1}");
    expect(readIntradayJsonFile<{ value: number }>(file).value).toBe(1);
    writeFileSync(file, "{\"value\":22}");
    utimesSync(file, new Date("2027-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"));
    expect(readIntradayJsonFile<{ value: number }>(file).value).toBe(22);
    const market = buildIntradayMarket(stored, [{ ticker: "AAPL", name: "Apple Inc." }], new Date("2026-11-13T14:50:00Z"));
    writeFileSync(file, JSON.stringify(market));
    utimesSync(file, new Date("2027-01-02T00:00:00Z"), new Date("2027-01-02T00:00:00Z"));
    const served = readIntradayMarketReport(file, new Date("2026-11-13T15:10:00Z"));
    expect(served?.session).toBe("2026-11-13");
    expect(served?.marketOpen).toBe(false);
  });
});
