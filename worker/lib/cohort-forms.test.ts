import { describe, expect, it } from "vitest";
import { isCohortSupportedForm } from "./cohort-forms";

describe("cohort supported forms", () => {
  it("accepts financial filings and 13D/13G amendments", () => {
    for (const form of ["10-K", "10-Q", "8-K", "10-K/A", "10-Q/A", "8-K/A", "SCHEDULE 13G", "SCHEDULE 13G/A", "SC 13G", "SC 13G/A"]) {
      expect(isCohortSupportedForm(form)).toBe(true);
    }
  });

  it("does not silently widen the form scope", () => {
    for (const form of ["DEF 14A", "S-1", "424B", "20-F", "6-K"]) {
      expect(isCohortSupportedForm(form)).toBe(false);
    }
  });
});
