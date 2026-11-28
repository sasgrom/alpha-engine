import { describe, expect, it } from "vitest";
import { r1000PanelGatesPass } from "./r1000-current-panel";

const gates = (overrides: Record<string, any> = {}) => ({
  overlap: { pass: true }, membership: { pass: true }, stooqContradictions: { pass: true }, identity: { pass: true },
  calendar: { pass: true }, chain: { pass: true }, splits: { pass: false }, schwabInvalidBars: { pass: false }, ...overrides,
});

describe("K35 current panel gates", () => {
  it("accepts the documented split and invalid-ticker qualifications", () => {
    expect(r1000PanelGatesPass(gates())).toBe(true);
  });

  it("requires verified common-equity evidence for a K35 refresh", () => {
    expect(r1000PanelGatesPass(gates(), true)).toBe(false);
    expect(r1000PanelGatesPass(gates({ securityTypes: { pass: false, status: "enabled", file: "types.json" } }), true)).toBe(false);
    expect(r1000PanelGatesPass(gates({ securityTypes: { pass: true, status: "enabled", file: "types.json" } }), true)).toBe(true);
  });

  it("refuses a failed calendar or chain gate", () => {
    expect(r1000PanelGatesPass(gates({ calendar: { pass: false } }))).toBe(false);
    expect(r1000PanelGatesPass(gates({ chain: { pass: false } }))).toBe(false);
  });

  it("refuses a failed overlap, membership, Stooq or identity gate", () => {
    for (const key of ["overlap", "membership", "stooqContradictions", "identity"]) {
      expect(r1000PanelGatesPass(gates({ [key]: { pass: false } }))).toBe(false);
    }
  });
});
