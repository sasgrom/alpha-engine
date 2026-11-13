import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMarketValueAt } from "./market-value";
import type { StoredBar } from "./prices";
import {
  applySplitEvents,
  buildSplitProfile,
  createSplitShareProvider,
  mergeSplitEvents,
  parsePriceAdjustmentLog,
  readPriceSplitEvents,
  type SplitEvent,
} from "./split-shares";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../queries/connection", () => ({ getDb }));

const temporaryDirectories: string[] = [];

function adjustment(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ticker: "SNDK",
    priceKey: 2023554,
    ratio: 0.125,
    firstNewBasisDate: "2026-11-20",
    dates: 4,
    detectedAt: "2026-11-20T23:00:00.000Z",
    dryRun: false,
    rebased: { schwab: 4 },
    ...overrides,
  };
}

function logLines(...rows: (Record<string, unknown> | string)[]): string {
  return (
    rows
      .map(row => (typeof row === "string" ? row : JSON.stringify(row)))
      .join("\n") + "\n"
  );
}

function priceEvents(...rows: Record<string, unknown>[]): SplitEvent[] {
  return parsePriceAdjustmentLog(logLines(...rows), "fixture.jsonl").events;
}

function secEvent(ratio: number, firstNewBasisFiled: string): SplitEvent {
  return { ratio, firstNewBasisFiled, evidence: [], tagValues: [] };
}

function temporaryLog(contents?: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), "alpha-k15-"));
  temporaryDirectories.push(directory);
  const file = path.join(directory, "price-adjustments.jsonl");
  if (contents !== undefined) writeFileSync(file, contents);
  return file;
}

function bar(date: string, close: number): StoredBar {
  return {
    date,
    close,
    open: close,
    high: close,
    low: close,
    adjClose: close,
    volume: 100,
    source: "schwab",
  };
}

afterEach(() => {
  vi.clearAllMocks();
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("price-derived split events", () => {
  it("adjusts old shares for an eight-for-one split from its first session", () => {
    const events = priceEvents(adjustment());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      ratio: 8,
      firstNewBasisFiled: "2026-11-20",
      source: "price",
      exDate: "2026-11-20",
    });
    expect(applySplitEvents(800, "2026-11-05", events).shares).toBe(6400);
    expect(applySplitEvents(6400, "2026-11-25", events).shares).toBe(6400);
  });

  it("uses a matching SEC boundary once when the filing confirms the split", () => {
    const filed = secEvent(8, "2027-02-03");
    const merged = mergeSplitEvents([filed], priceEvents(adjustment()));
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(filed);
    expect(applySplitEvents(800, "2026-11-05", merged).shares).toBe(6400);
    expect(applySplitEvents(6400, "2027-02-03", merged).shares).toBe(6400);
    expect(
      mergeSplitEvents(
        [secEvent(8, "2026-10-21")],
        priceEvents(adjustment())
      ).map(event => event.firstNewBasisFiled)
    ).toEqual(["2026-10-21"]);
  });

  it("keeps different ratios and filings more than 200 days later separate", () => {
    const merged = mergeSplitEvents(
      [secEvent(2, "2027-02-03"), secEvent(8, "2027-08-01")],
      priceEvents(adjustment())
    );
    expect(
      merged.map(event => [event.ratio, event.firstNewBasisFiled])
    ).toEqual([
      [8, "2026-11-20"],
      [2, "2027-02-03"],
      [8, "2027-08-01"],
    ]);
    expect(applySplitEvents(100, "2026-11-05", merged).ratio).toBe(128);
  });

  it("converts a log ratio of eight to a one-for-eight reverse split", () => {
    const events = priceEvents(adjustment({ ratio: 8 }));
    expect(events[0].ratio).toBe(0.125);
    expect(applySplitEvents(6400, "2026-11-05", events).shares).toBe(800);
    expect(applySplitEvents(800, "2026-11-25", events).shares).toBe(800);
  });

  it("reports non-split price adjustments without changing shares", () => {
    const diagnostics = parsePriceAdjustmentLog(
      logLines(adjustment({ ratio: 1 / 1.28 })),
      "fixture.jsonl"
    );
    expect(diagnostics.events).toEqual([]);
    expect(diagnostics.nonSplitAdjustments).toEqual([
      expect.objectContaining({
        priceKey: 2023554,
        ticker: "SNDK",
        ratio: 1 / 1.28,
        splitRatio: 1.28,
        firstNewBasisDate: "2026-11-20",
      }),
    ]);
    expect(applySplitEvents(800, "2026-11-05", diagnostics.events)).toEqual({
      shares: 800,
      ratio: 1,
      events: [],
    });
  });

  it("ignores dry runs, duplicates, and malformed lines without hiding diagnostics", () => {
    const diagnostics = parsePriceAdjustmentLog(
      logLines(
        adjustment(),
        adjustment(),
        "{not valid json",
        adjustment({ firstNewBasisDate: "2026-02-30" }),
        adjustment({ dryRun: true })
      ),
      "fixture.jsonl"
    );
    expect(diagnostics).toMatchObject({
      lines: 5,
      malformedLines: 2,
      dryRunLines: 1,
      duplicateEvents: 1,
      nonSplitAdjustments: [],
    });
    expect(diagnostics.events).toHaveLength(1);
    const dryRun = parsePriceAdjustmentLog(
      logLines(adjustment({ dryRun: true })),
      "fixture.jsonl"
    );
    expect(applySplitEvents(800, "2026-11-05", dryRun.events)).toEqual({
      shares: 800,
      ratio: 1,
      events: [],
    });
  });

  it("preserves SEC-only behavior when the log is missing or empty", () => {
    const missing = readPriceSplitEvents(temporaryLog());
    expect(missing).toMatchObject({
      exists: false,
      readError: null,
      lines: 0,
      malformedLines: 0,
      dryRunLines: 0,
      duplicateEvents: 0,
      nonSplitAdjustments: [],
      events: [],
    });
    const profile = buildSplitProfile([]);
    expect(mergeSplitEvents(profile.events, missing.events)).toEqual(
      profile.events
    );
    expect(parsePriceAdjustmentLog("\n\r\n", "empty.jsonl")).toMatchObject({
      lines: 0,
      malformedLines: 0,
      events: [],
    });
  });

  it("reads a log once until its modification time changes", () => {
    const file = temporaryLog(logLines(adjustment()));
    const firstTime = new Date("2026-01-01T00:00:00.000Z");
    utimesSync(file, firstTime, firstTime);
    const first = readPriceSplitEvents(file);
    expect(readPriceSplitEvents(file)).toBe(first);
    expect(first.events[0].ratio).toBe(8);

    writeFileSync(
      file,
      logLines(adjustment({ ratio: 0.25, firstNewBasisDate: "2026-12-01" }))
    );
    const secondTime = new Date("2026-01-02T00:00:00.000Z");
    utimesSync(file, secondTime, secondTime);
    const second = readPriceSplitEvents(file);
    expect(second).not.toBe(first);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toMatchObject({
      ratio: 4,
      firstNewBasisFiled: "2026-12-01",
    });
  });

  it("keeps SNDK-like market value continuous across an eight-for-one split", async () => {
    getDb.mockReturnValue({
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          [
            {
              concept: "WeightedAverageNumberOfSharesOutstandingBasic",
              startDate: "2026-07-01",
              endDate: "2026-09-30",
              val: 8000,
              filed: "2026-11-05",
              accn: "old-basis-10-q",
              form: "10-Q",
            },
          ],
        ])
        .mockResolvedValueOnce([
          [
            {
              concept: "WeightedAverageNumberOfSharesOutstandingBasic",
              periodEnd: "2026-09-30",
              vintage: "first",
              val: 8000,
              sourceAccn: "old-basis-10-q",
              sourceFiled: "2026-11-05",
            },
            {
              concept: "WeightedAverageNumberOfSharesOutstandingBasic",
              periodEnd: "2026-09-30",
              vintage: "latest",
              val: 8000,
              sourceAccn: "old-basis-10-q",
              sourceFiled: "2026-11-05",
            },
          ],
        ]),
    });
    const provider = await createSplitShareProvider(
      2023554,
      temporaryLog(
        logLines(
          adjustment(),
          adjustment({ ticker: "OTHER", priceKey: 1, ratio: 0.5 })
        )
      )
    );
    const preSplitClose = 800;
    const rebasedClose = preSplitClose * 0.125;
    const bars = [bar("2026-11-19", rebasedClose)];
    const before = await getMarketValueAt(
      2023554,
      "2026-11-19",
      provider,
      bars
    );
    const after = await getMarketValueAt(2023554, "2026-11-20", provider, [
      ...bars,
      bar("2026-11-20", rebasedClose),
    ]);
    expect(before.shares).toMatchObject({
      rawShares: 8000,
      shares: 64000,
      ratio: 8,
    });
    expect(before.marketCap).toBe(8000 * preSplitClose);
    expect(after.marketCap).toBe(before.marketCap);
    expect(provider.profile.events).toHaveLength(1);
    expect(provider.profile.events[0]).toMatchObject({
      priceKey: 2023554,
      ticker: "SNDK",
      source: "price",
    });
    expect(provider.diagnostics.events).toHaveLength(2);
  });
});
