// Unit tests for the 4i (D41) factor library — pure math only.
import { describe, it, expect } from "vitest";
import {
  accruals, grossProfitability, assetGrowth, buybackYield,
  momentum122, high52Proximity, sue, piotroskiF, altmanZ, beneishM,
} from "./factors";

describe("flow/quality factors", () => {
  it("accruals = (NI−CFO)/assets, honest nulls", () => {
    expect(accruals(100, 80, 1000)).toBeCloseTo(0.02);
    expect(accruals(null, 80, 1000)).toBeNull();
    expect(accruals(100, 80, 0)).toBeNull();
  });
  it("grossProfitability = GP/assets", () => {
    expect(grossProfitability(50, 200)).toBeCloseTo(0.25);
    expect(grossProfitability(50, null)).toBeNull();
  });
  it("assetGrowth YoY", () => {
    expect(assetGrowth(110, 100)).toBeCloseTo(0.1);
    expect(assetGrowth(110, 0)).toBeNull();
  });
  it("buybackYield = −Δshares + div/mcap", () => {
    // shares fell 2%, dividends 1% of mcap → +3%
    expect(buybackYield(98, 100, 1e9, 1e11)).toBeCloseTo(0.03);
    expect(buybackYield(100, 100, null, 1e11)).toBeCloseTo(0);
  });
});

describe("price factors", () => {
  const bars = Array.from({ length: 300 }, (_, i) => ({ date: `2025-01-01+${i}`, close: 100 + i * 0.5 }));
  it("momentum122 skips the last month", () => {
    const m = momentum122(bars);
    expect(m).not.toBeNull();
    expect(m!).toBeCloseTo((100 + (300 - 22 - 1) * 0.5) / 100 - 1, 3);
    expect(momentum122(bars.slice(0, 100))).toBeNull();
  });
  it("high52Proximity", () => {
    expect(high52Proximity(95, 100)).toBeCloseTo(0.95);
    expect(high52Proximity(95, 0)).toBeNull();
  });
  it("sue = (EPS_q − EPS_q-4)/σ(diffs)", () => {
    // desc input (newest first), rising EPS with non-constant diffs
    const eps = [3.2, 2.9, 2.4, 2.3, 2.0, 2.1, 1.7, 1.5];
    const s = sue(eps);
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThan(0);
    expect(sue([1, 2])).toBeNull();
  });
});

describe("Piotroski F-score", () => {
  it("all-pass scores 9; honest nulls don't count", () => {
    const allGood = {
      roaNow: 0.1, roaPrev: 0.08, cfoNow: 50, accrualsNow: -0.01, accrualsPrev: 0.01,
      leverageNow: 0.3, leveragePrev: 0.35, currentNow: 2.2, currentPrev: 2.0,
      sharesNow: 100, sharesPrev: 101, gmNow: 0.4, gmPrev: 0.38, turnoverNow: 1.1, turnoverPrev: 1.0,
    };
    expect(piotroskiF(allGood).score).toBe(9);
    const withNulls = piotroskiF({ ...allGood, gmNow: null });
    expect(withNulls.score).toBe(8);
    expect(withNulls.signals.find((s) => s.key.includes("gross margin"))!.pass).toBeNull();
  });
});

describe("Altman Z / Beneish M", () => {
  it("altmanZ computes the classic weights", () => {
    // WC/TA .1, RE/TA .2, EBT/TA .15, ME/TL 2, S/TA 1 → 0.12+0.28+0.495+1.2+1.0 = 3.095
    expect(altmanZ({ wc: 100, retained: 200, ebt: 150, marketCap: 400, liab: 200, sales: 1000, assets: 1000 })).toBeCloseTo(3.095);
    expect(altmanZ({ wc: null, retained: 1, ebt: 1, marketCap: 1, liab: 1, sales: 1, assets: 1 })).toBeNull();
  });
  it("beneishM fails closed on missing components", () => {
    expect(beneishM({
      arNow: null, arPrev: 1, revNow: 1, revPrev: 1, gpNow: 1, gpPrev: 1,
      caNow: 1, caPrev: 1, ppeNow: 1, ppePrev: 1, assetsNow: 1, assetsPrev: 1,
      daNow: 1, daPrev: 1, sgaNow: 1, sgaPrev: 1, liabNow: 1, liabPrev: 1, niNow: 1, cfoNow: 1,
    })).toBeNull();
  });
});
