import { describe, expect, it } from "vitest";
import { medianOf, neutralizeBySector, type SectorReturnPoint } from "./sector-neutral-ic";

const point = (sector: string, x: number, y: number, cik: number): SectorReturnPoint => ({
  cik, sector, factor: "bookToMarket", quarter: "2026-07", horizon: 126, x, y,
});

describe("sector-neutral residual construction", () => {
  it("demes both factor and returns within sector and uses global fallback for small groups", () => {
    const rows = [
      point("A", 1, 0.1, 1), point("A", 2, 0.2, 2), point("A", 3, 0.3, 3), point("A", 4, 0.4, 4),
      point("B", 10, 0.5, 5), point("B", 20, 0.6, 6), point("B", 30, 0.7, 7),
    ];
    const out = neutralizeBySector(rows);
    const a2 = out.find((r) => r.cik === 2)!;
    const b20 = out.find((r) => r.cik === 6)!;
    expect(a2.x).toBeCloseTo(-0.5);
    expect(a2.y).toBeCloseTo(-0.05); // sector A median return = 0.25
    expect(a2.xMethod).toBe("sector");
    expect(a2.yMethod).toBe("sector");
    expect(b20.x).toBeCloseTo(16); // global factor median = 4
    expect(b20.y).toBeCloseTo(0.2); // global return median = 0.4
    expect(b20.xMethod).toBe("global");
    expect(b20.yMethod).toBe("global");
  });

  it("computes medians with averaging for even counts", () => {
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([2, 1, 4])).toBe(2);
  });
});
