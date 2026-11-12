import { describe, expect, it } from "vitest";
import { archiveSteps } from "./accepted-price-history";

describe("accepted archive history", () => {
  it("reproduces PG 1987 and BNY 1992 steps", () => {
    const pg = archiveSteps([
      { date: "1987-10-16", before: 1, after: 1, ratio: 0.460825495388549 },
      {
        date: "1987-10-19",
        before: 2.68874,
        after: 1.4423,
        ratio: 0.5364222647039133,
      },
    ]);
    const bny = archiveSteps([
      { date: "1992-01-16", before: 1, after: 1, ratio: 0.15296482734040548 },
      {
        date: "1992-01-17",
        before: 2.44095,
        after: 0.426986,
        ratio: 0.1749261557999959,
      },
    ]);
    expect(pg[0].step).toBeCloseTo(0.1640464125180927, 12);
    expect(bny[0].step).toBeCloseTo(0.14357109958826042, 12);
  });

  it("keeps an ordinary dividend-sized step below 15%", () => {
    const rows = archiveSteps([
      { date: "2026-01-01", before: 1, after: 1, ratio: 0.9741 },
      { date: "2026-02-01", before: 1, after: 1, ratio: 0.9809 },
    ]);
    expect(rows[0].step).toBeLessThan(0.15);
  });
});
