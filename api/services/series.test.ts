// Unit tests for the 4f (D37) generalized quarter derivation.
import { describe, it, expect } from "vitest";
import { deriveQuarterFromYtd } from "./series";

const row = (startDate: string, endDate: string, val: number | null, unit = "USD") => ({
  startDate, endDate, val, unit, accn: "0001-x", filed: "2026-01-30",
});

describe("deriveQuarterFromYtd (D37)", () => {
  it("Q4 = FY − 9M YTD (same fiscal-year start)", () => {
    const d = deriveQuarterFromYtd(
      row("2024-09-29", "2025-09-27", 391035),   // FY25
      row("2024-09-29", "2025-06-28", 288569)    // 9M FY25
    );
    expect(d).not.toBeNull();
    expect(d!.val).toBe(102466);
    expect(d!.unit).toBe("USD");
  });
  it("Q2 = H1 − Q1 and Q3 = 9M − H1 use the same rule", () => {
    const q2 = deriveQuarterFromYtd(row("2025-09-28", "2026-03-28", 200), row("2025-09-28", "2025-12-27", 80));
    expect(q2?.val).toBe(120);
    const q3 = deriveQuarterFromYtd(row("2025-09-28", "2026-06-27", 300), row("2025-09-28", "2026-03-28", 200));
    expect(q3?.val).toBe(100);
  });
  it("refuses a fiscal-year-start mismatch (different startDate)", () => {
    // the small window starts a quarter later — subtracting it would be wrong
    const d = deriveQuarterFromYtd(row("2024-09-29", "2025-09-27", 100), row("2025-01-01", "2025-06-28", 40));
    expect(d).toBeNull();
  });
  it("refuses non-adjacent ends (gap > one quarter)", () => {
    const d = deriveQuarterFromYtd(row("2024-09-29", "2025-09-27", 100), row("2024-09-29", "2025-03-29", 50));
    expect(d).toBeNull(); // ~182 days = two quarters, not one
  });
  it("fails closed on null values and unit mismatch", () => {
    expect(deriveQuarterFromYtd(row("2024-09-29", "2025-09-27", null), row("2024-09-29", "2025-06-28", 1))).toBeNull();
    const a = row("2024-09-29", "2025-09-27", 10, "USD");
    const b = row("2024-09-29", "2025-06-28", 4, "shares");
    expect(deriveQuarterFromYtd(a, b)).toBeNull();
  });
});
