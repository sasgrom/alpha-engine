import { describe, expect, it } from "vitest";
import { buildFactorPointRows } from "./factor-ic";

describe("factor point availability mapping", () => {
  it("uses first-filed fundamentals, own-date market factors and a 45-day fallback", () => {
    const rows = buildFactorPointRows(1, {
      assetGrowth: { history: [{ t: "2024-12-31", v: 0.2 }] },
      momentum122: { history: [{ t: "2024-12-31", v: 0.1 }] },
      quality: { history: [{ t: "2024-09-30", v: null }] },
    }, new Map([["2024-12-31", "2025-02-01 00:00:00"]]));
    expect(rows.find((r) => r.factor === "assetGrowth")?.filedAt).toBe("2025-02-01 00:00:00");
    expect(rows.find((r) => r.factor === "momentum122")?.filedAt).toBe("2024-12-31 00:00:00");
    expect(rows.find((r) => r.factor === "quality")?.filedAt).toBe("2024-11-14 00:00:00");
    expect(rows.find((r) => r.factor === "quality")?.value).toBeNull();
  });
});
