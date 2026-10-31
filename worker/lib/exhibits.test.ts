import { describe, expect, it } from "vitest";
import { exhibitCacheName, mergeGuidanceStatus, selectSubstantiveExhibits } from "./exhibits";

describe("substantive EX-99 coverage", () => {
  it("keeps both the main release and supplement instead of only the largest", () => {
    const selected = selectSubstantiveExhibits([
      { name: "jpm-20260930.htm", size: 10_000 },
      { name: "a3q26erfex991.htm", size: 30_000 },
      { name: "a3q26erfex992supplement.htm", size: 90_000 },
      { name: "index.json", size: 5_000 },
    ], "jpm-20260930.htm");
    expect(selected.map((doc) => doc.name)).toEqual(["a3q26erfex992supplement.htm", "a3q26erfex991.htm"]);
  });

  it("uses the largest textual document only as a legacy fallback", () => {
    expect(selectSubstantiveExhibits([{ name: "press.htm", size: 50_000 }, { name: "notes.htm", size: 10_000 }], null).map((doc) => doc.name)).toEqual(["press.htm"]);
    expect(selectSubstantiveExhibits([{ name: "cover.htm", size: 3_000 }], null)).toEqual([]);
  });

  it("creates traversal-safe deterministic cache names", () => {
    expect(exhibitCacheName("0001628280-26-065582", "a3q26erfex992supplement.htm")).toBe("000162828026065582.ex-a3q26erfex992supplement.htm");
    expect(exhibitCacheName("0001628280-26-065582", "../press release.htm")).not.toContain("..");
  });

  it("merges multi-exhibit guidance states without hiding a found release", () => {
    expect(mergeGuidanceStatus(["not_found", "found"])).toBe("found");
    expect(mergeGuidanceStatus(["not_found", "deferred_to_call"])).toBe("deferred_to_call");
    expect(mergeGuidanceStatus(["not_found"])).toBe("not_found");
    expect(mergeGuidanceStatus([])).toBeNull();
  });
});
