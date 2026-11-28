import { describe, expect, it } from "vitest";
import { edgarFetchForms, edgarFetchLimit } from "./edgar-fetch-controls";

describe("EDGAR primary-document fetch controls", () => {
  it("limits a pilot and selects only periodic reports and amendments", () => {
    expect(edgarFetchLimit("20")).toBe(20);
    expect(edgarFetchLimit(null)).toBeNull();
    expect(() => edgarFetchLimit("0")).toThrow(/positive integer/);
    expect([...edgarFetchForms("10-K,10-Q")!].sort()).toEqual([
      "10-K",
      "10-K/A",
      "10-Q",
      "10-Q/A",
    ]);
    expect(edgarFetchForms(null)).toBeNull();
    expect(() => edgarFetchForms("DEF 14A")).toThrow(/accepts 10-K, 10-Q and 8-K/);
  });

  it("supports earnings forms and their amendments for a metadata-only scope", () => {
    expect([...edgarFetchForms("8-K")!].sort()).toEqual(["8-K", "8-K/A"]);
    expect([...edgarFetchForms("10-K,10-Q,8-K")!].sort()).toEqual(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A"]);
    expect([...edgarFetchForms("10-K,10-K/A,10-Q,10-Q/A,8-K,8-K/A")!].sort()).toEqual(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A"]);
  });
});
