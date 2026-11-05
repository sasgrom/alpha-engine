import { describe, expect, it } from "vitest";
import { chooseDailyPrice, type DailyPriceCandidate } from "./daily-price";

const row = (source: string, close: number | null, fetchedAt: string, id = 1): DailyPriceCandidate => ({
  id,
  cik: 1,
  date: "2026-11-04",
  open: 100,
  high: 101,
  low: 99,
  close,
  adjClose: null,
  volume: 1000,
  source,
  fetchedAt,
});

describe("daily price source selection", () => {
  it("prefers an eligible official Schwab close", () => {
    const result = chooseDailyPrice([row("stooq", 90, "2026-10-28T00:00:00Z"), row("schwab", 103.61, "2026-11-05T12:00:00Z", 2)], 1, "2026-11-04", "2026-11-05T13:00:00Z");
    expect(result.status).toBe("ready");
    expect(result.source).toBe("schwab");
    expect(result.price).toBe(103.61);
    expect(result.quality).toBe("official_close");
    expect(result.actualAsOf).toBe("2026-11-04");
    expect(result.currency).toBe("USD");
    expect(result.bar?.open).toBe(100);
  });

  it("uses Stooq only when Schwab is not eligible at asOf", () => {
    const result = chooseDailyPrice([row("schwab", 103.61, "2026-11-05T12:00:00Z", 2), row("stooq", 90, "2026-10-28T00:00:00Z")], 1, "2026-11-04", "2026-10-28T01:00:00Z");
    expect(result.source).toBe("stooq");
    expect(result.price).toBe(90);
    expect(result.quality).toBe("historical_backfill");
  });

  it("returns stale when every candidate arrives after asOf", () => {
    const result = chooseDailyPrice([row("schwab", 103.61, "2026-11-05T12:00:00Z")], 1, "2026-11-04", "2026-11-01T00:00:00Z");
    expect(result.status).toBe("stale");
    expect(result.price).toBeNull();
  });

  it("returns missing instead of fabricating a close from an invalid value", () => {
    expect(chooseDailyPrice([row("schwab", null, "2026-11-05T12:00:00Z")], 1, "2026-11-04", "2026-11-05T13:00:00Z").status).toBe("missing");
    expect(chooseDailyPrice([row("schwab", 0, "2026-11-05T12:00:00Z")], 1, "2026-11-04", "2026-11-05T13:00:00Z").status).toBe("missing");
    expect(chooseDailyPrice([row("yahoo", 90, "2026-10-28T00:00:00Z")], 1, "2026-11-04", "2026-11-05T13:00:00Z").status).toBe("missing");
  });

  it("rejects invalid date and asOf inputs", () => {
    expect(() => chooseDailyPrice([], 1, "11/04/2026", "2026-11-05T13:00:00Z")).toThrow("Invalid daily price date or asOf");
    expect(() => chooseDailyPrice([], 1, "2026-11-04", "not-a-date")).toThrow("Invalid daily price date or asOf");
  });
});
