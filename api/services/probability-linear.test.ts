import { describe, it, expect } from "vitest";
import { linearIdentityGroups } from "./probability";

const xs = Array.from({ length: 40 }, (_, i) => i + 1);

describe("linearIdentityGroups", () => {
  it("groups only true linear derivatives (marketCap = price × shares)", () => {
    const price = xs.map((x) => x * 10 + 5);
    const cap = price.map((p) => p * 1000);
    const groups = linearIdentityGroups([
      { factor: "price", values: price },
      { factor: "marketCap", values: cap },
      { factor: "volume", values: xs.map((x) => Math.sin(x) * 50 + 100) },
    ]);
    const capGroup = groups.find((g) => g.members.includes("marketCap"));
    expect(capGroup).toBeDefined();
    expect(capGroup!.members).toContain("price");
    expect(groups.find((g) => g.members.includes("volume") && g.members.length > 1)).toBeUndefined();
  });
  it("does not group merely correlated (nonlinear) series", () => {
    const a = xs.map((x) => x * 2);
    const b = xs.map((x) => x * x * 0.5);
    const groups = linearIdentityGroups([{ factor: "a", values: a }, { factor: "b", values: b }]);
    expect(groups.every((g) => g.members.length === 1)).toBe(true);
  });
  it("rejects slope drift even at high R²", () => {
    const a = xs.map((x) => x);
    const b = xs.map((x, i) => (i < 20 ? x * 1 : x * 5));
    const groups = linearIdentityGroups([{ factor: "a", values: a }, { factor: "b", values: b }]);
    expect(groups.every((g) => g.members.length === 1)).toBe(true);
  });
});
