import { describe, expect, it } from "vitest";
import { canFixedGammaChangeSign, dollarGex, netGex } from "./gamma-exposure";

describe("dollar gamma exposure", () => {
  it("computes Γ · OI · multiplier · S² · 0.01 and validates inputs", () => {
    const input = { right: "call" as const, gamma: 0.001, openInterest: 1000, multiplier: 100, spot: 200 };
    expect(dollarGex(input)).toBe(40_000);
    expect(dollarGex({ ...input, openInterest: -1 })).toBeNull();
    expect(dollarGex({ ...input, spot: 0 })).toBeNull();
  });

  it("treats calls-minus-puts as a scenario and proves fixed gamma cannot flip sign", () => {
    const call = { right: "call" as const, gamma: 0.001, openInterest: 1000, multiplier: 100, spot: 200 };
    const put = { right: "put" as const, gamma: 0.002, openInterest: 500, multiplier: 100, spot: 200 };
    expect(netGex([call, put])).toBe(0);
    expect(netGex([{ ...call, spot: 180 }, { ...put, spot: 180 }])).toBe(0);
    expect(canFixedGammaChangeSign([call, put])).toBe(false);
  });
});
