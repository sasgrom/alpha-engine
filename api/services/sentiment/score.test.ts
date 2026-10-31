/**
 * Tests for the pure helpers of the Stage 2.2 scoring service (3h):
 * like-with-like pairwise prior selection. DB-touching paths are not
 * covered here.
 */
import { describe, expect, it } from "vitest";
import { pickPriorSameForm, evidenceVerified } from "./score";

const tl = (rows: [number, string, string][]) =>
  rows.map(([docId, form, filingDate]) => ({ docId, form, filingDate }));

describe("pickPriorSameForm (like-with-like pairwise)", () => {
  // filingDate-DESC timeline: newest first
  const timeline = tl([
    [5, "10-K", "2026-08-01"],
    [4, "10-Q", "2026-05-01"],
    [3, "10-K/A", "2025-11-15"],
    [2, "10-K", "2025-08-01"],
    [1, "10-Q", "2025-05-01"],
  ]);

  it("pairs a 10-K with the nearest older 10-K (never a 10-Q)", () => {
    const p = pickPriorSameForm(timeline, { docId: 5, form: "10-K", filingDate: "2026-08-01" });
    expect(p?.docId).toBe(3); // 10-K/A counts as the same base form
  });

  it("pairs a 10-Q with the nearest older 10-Q", () => {
    const p = pickPriorSameForm(timeline, { docId: 4, form: "10-Q", filingDate: "2026-05-01" });
    expect(p?.docId).toBe(1);
  });

  it("amendments pair with their base form", () => {
    const p = pickPriorSameForm(timeline, { docId: 3, form: "10-K/A", filingDate: "2025-11-15" });
    expect(p?.docId).toBe(2);
  });

  it("returns null when no same-form prior exists (honest non-pairwise)", () => {
    const p = pickPriorSameForm(timeline, { docId: 1, form: "10-Q", filingDate: "2025-05-01" });
    expect(p).toBeNull();
  });

  it("never pairs a document with itself, even on equal dates", () => {
    const t2 = tl([
      [7, "10-Q", "2026-05-01"],
      [4, "10-Q", "2026-05-01"],
    ]);
    const p = pickPriorSameForm(t2, { docId: 7, form: "10-Q", filingDate: "2026-05-01" });
    expect(p).toBeNull(); // equal date is not OLDER
  });
});

describe("evidenceVerified", () => {
  it("matches quotes modulo whitespace and case", () => {
    expect(evidenceVerified("We  believe\n revenue will grow", "… we believe revenue will grow …")).toBe(true);
    expect(evidenceVerified("not in the text", "… we believe revenue will grow …")).toBe(false);
  });
});
