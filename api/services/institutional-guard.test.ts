import { describe, expect, it } from "vitest";
import { buildGuardMeta, comparableFunds, filingDeadline, selectQuarterPair } from "./institutional-guard";

describe("13F quarter selection", () => {
  it("excludes an open filing window and reports the skipped latest quarter", () => {
    const pair = selectQuarterPair([
      { quarterDate: "2026-09-30", funds: 9 },
      { quarterDate: "2026-06-30", funds: 299 },
      { quarterDate: "2026-03-31", funds: 292 },
      { quarterDate: "2025-12-31", funds: 285 },
    ], "2026-10-25")!;
    expect(filingDeadline("2026-09-30")).toBe("2026-11-14");
    expect(pair.cur).toBe("2026-06-30");
    expect(pair.prev).toBe("2026-03-31");
    expect(pair.expectedFunds).toBe(299);
    expect(pair.skippedLatestQuarter).toBe("2026-09-30");
    expect(pair.partial).toBe(true);
    expect(pair.warnings.join(" ")).toContain("filing window open");
  });

  it("skips an under-covered previous quarter when choosing a pair", () => {
    const pair = selectQuarterPair([
      { quarterDate: "2026-06-30", funds: 299 },
      { quarterDate: "2026-03-31", funds: 100 },
      { quarterDate: "2025-12-31", funds: 290 },
    ], "2026-10-25")!;
    expect(pair.cur).toBe("2026-06-30");
    expect(pair.prev).toBe("2025-12-31");
  });

  it("fails closed when no quarter has enough funds", () => {
    expect(selectQuarterPair([{ quarterDate: "2026-06-30", funds: 1 }], "2026-10-25")).toBeNull();
    expect(selectQuarterPair([{ quarterDate: "2026-09-30", funds: 300 }], "2026-10-25")).toBeNull();
  });
});

describe("13F comparable-fund guard", () => {
  it("separates stable, missing, and book-count-anomalous funds", () => {
    const rows = [
      { fundCik: 1, quarterDate: "cur", positions: 371 }, { fundCik: 1, quarterDate: "prev", positions: 6 },
      { fundCik: 2, quarterDate: "cur", positions: 100 }, { fundCik: 2, quarterDate: "prev", positions: 100 },
      { fundCik: 3, quarterDate: "cur", positions: 50 },
      { fundCik: 4, quarterDate: "prev", positions: 50 },
      { fundCik: 5, quarterDate: "cur", positions: 40 }, { fundCik: 5, quarterDate: "prev", positions: 45 },
    ];
    const result = comparableFunds(rows, "cur", "prev");
    expect(result.stable).toEqual([2, 5]);
    expect(result.missing).toEqual([3, 4]);
    expect(result.suspect).toEqual([1]);
  });

  it("adds explicit warnings and disables flows below two stable funds", () => {
    const selection = selectQuarterPair([
      { quarterDate: "2026-06-30", funds: 2 }, { quarterDate: "2026-03-31", funds: 2 },
    ], "2026-10-25")!;
    const meta = buildGuardMeta(selection, { stable: [1], missing: [2], suspect: [] });
    expect(meta.partial).toBe(true);
    expect(meta.warnings.join(" ")).toContain("Insufficient comparable funds");
  });
});
