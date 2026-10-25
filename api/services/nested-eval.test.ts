import { describe, expect, it } from "vitest";
import { classificationMetrics, nonOverlapping, splitNested, type AnchorPoint } from "./nested-eval";

function pt(anchor: string, exitDate: string, ret = 0.1, rawP = 0.6): AnchorPoint {
  return { cik: 1, anchor, exitDate, ret, rawP, features: [0] };
}

describe("6c nested evaluation primitives", () => {
  it("keeps the final four anchors untouched and splits development chronologically", () => {
    const points = Array.from({ length: 28 }, (_, i) => pt(`2020-${String(Math.floor(i / 4) + 1).padStart(2, "0")}-${String((i % 4) * 7 + 1).padStart(2, "0")}`, "2021-01-01"));
    const split = splitNested(points)!;
    expect(split.fit).toHaveLength(12);
    expect(split.cal).toHaveLength(6);
    expect(split.evaluation).toHaveLength(6);
    expect(split.holdout).toHaveLength(4);
    expect(split.holdout[0]).toBe(points[24]);
    expect(split.fit.at(-1)!.anchor < split.cal[0].anchor).toBe(true);
    expect(split.cal.at(-1)!.anchor < split.evaluation[0].anchor).toBe(true);
  });

  it("drops overlapping return windows from money-performance series", () => {
    const rows = nonOverlapping([
      pt("2026-01-02", "2026-04-03"),
      pt("2026-02-02", "2026-05-04"),
      pt("2026-04-03", "2026-07-06"),
      pt("2026-05-01", "2026-08-03"),
    ]);
    expect(rows.map((p) => p.anchor)).toEqual(["2026-01-02", "2026-04-03"]);
  });

  it("reports confusion, class precision and majority baseline explicitly", () => {
    const rows = [pt("a", "b", 0.1, 0.6), pt("b", "c", -0.1, 0.6), pt("c", "d", 0.1, 0.4), pt("d", "e", -0.1, 0.4)];
    const m = classificationMetrics(rows, (p) => p.rawP >= 0.5);
    expect({ tp: m.tp, fp: m.fp, tn: m.tn, fn: m.fn }).toEqual({ tp: 1, fp: 1, tn: 1, fn: 1 });
    expect(m.acc).toBe(0.5);
    expect(m.upAcc).toBe(0.5);
    expect(m.downAcc).toBe(0.5);
    expect(m.majorityBaseline).toBe(0.5);
  });
});
