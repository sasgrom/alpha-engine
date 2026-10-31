// Unit tests for the events stream parser (4a, D28).
import { describe, it, expect } from "vitest";
import { isEarningsRelease } from "./events";

describe("isEarningsRelease (8-K Item 2.02 token match)", () => {
  it("matches a standalone 2.02 token in SEC item lists", () => {
    expect(isEarningsRelease("2.02")).toBe(true);
    expect(isEarningsRelease("2.02,9.01")).toBe(true);
    expect(isEarningsRelease("5.07, 2.02, 9.01")).toBe(true);
  });
  it("does NOT match lookalikes (substring trap)", () => {
    expect(isEarningsRelease("12.02")).toBe(false);      // "2.02" substring of 12.02
    expect(isEarningsRelease("2.02a")).toBe(false);
    expect(isEarningsRelease("1.01,2.03")).toBe(false);
  });
  it("tolerates the 'Item ' prefix and odd spacing", () => {
    expect(isEarningsRelease("Item 2.02, Item 9.01")).toBe(true);
    expect(isEarningsRelease("  2.02 ,  9.01 ")).toBe(true);
  });
  it("null/empty are not events", () => {
    expect(isEarningsRelease(null)).toBe(false);
    expect(isEarningsRelease("")).toBe(false);
    expect(isEarningsRelease(undefined)).toBe(false);
  });
});
