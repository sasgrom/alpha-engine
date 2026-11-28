import { describe, expect, it } from "vitest";
import { r1000NonCommonReason, r1000SecurityType, type R1000SecurityType } from "./r1000-security-types";

const security = (overrides: Partial<R1000SecurityType> = {}): R1000SecurityType => ({
  cik: 1, ticker: "AAA", name: "Common", exchange: "NYSE", assetType: "EQUITY", assetSubType: "COE", description: "COMMON", exchangeName: "NYSE", ...overrides,
});

describe("Russell security types", () => {
  it("reads Schwab reference fields without treating a missing answer as common", () => {
    expect(r1000SecurityType({ cik: 1, ticker: "AAA", name: "Common", exchange: "NYSE" }, { assetMainType: "EQUITY", assetSubType: "COE", reference: { description: "COMMON A", exchangeName: "NYSE" } })).toMatchObject({ assetSubType: "COE", description: "COMMON A", exchangeName: "NYSE" });
    expect(r1000NonCommonReason(security({ assetType: null, assetSubType: null, description: null }))).toBe("unresolved-security-type");
  });

  it("keeps national-exchange common stock and REITs", () => {
    expect(r1000NonCommonReason(security())).toBeNull();
    expect(r1000NonCommonReason(security({ assetSubType: null, description: "PROPERTY COMPANY REIT" }))).toBeNull();
  });

  it("refuses preferreds, notes, warrants, receipts and unapproved OTC lines", () => {
    expect(r1000NonCommonReason(security({ assetSubType: "PRF", description: "9.375% NOTE" }))).toBe("non-common-subtype:PRF");
    expect(r1000NonCommonReason(security({ assetSubType: "WAR" }))).toBe("non-common-subtype:WAR");
    expect(r1000NonCommonReason(security({ assetSubType: null, description: "ISSUER RECEIPT" }))).toBe("otc-receipt");
    expect(r1000NonCommonReason(security({ exchange: "OTC", exchangeName: null }))).toBe("unapproved-otc-line");
    expect(r1000NonCommonReason(security({ exchange: "OTC", exchangeName: null }), true)).toBeNull();
  });
});
