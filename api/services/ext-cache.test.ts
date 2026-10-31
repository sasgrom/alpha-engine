// Unit tests for the TTL decision of the external cache (3l, D27).
// The DB path is exercised by t_3l_cache.mts (needs MySQL).
import { describe, it, expect } from "vitest";
import { cacheState } from "./ext-cache";

describe("cacheState", () => {
  const now = 1_000_000;
  it("miss without a row", () => {
    expect(cacheState(null, now, 1000)).toBe("miss");
  });
  it("fresh within TTL (boundary inclusive)", () => {
    expect(cacheState(now - 999, now, 1000)).toBe("fresh");
    expect(cacheState(now - 1000, now, 1000)).toBe("fresh");
  });
  it("stale past TTL", () => {
    expect(cacheState(now - 1001, now, 1000)).toBe("stale");
    expect(cacheState(0, now, 1000)).toBe("stale");
  });
});
