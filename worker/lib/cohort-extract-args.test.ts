import { describe, expect, it } from "vitest";
import { accessionMatches, assertAccessionTasks, shouldResumeCohortEntry } from "./cohort-extract-args";

describe("cohort accession filter", () => {
  it("keeps only the exact requested accession", () => {
    expect(accessionMatches({ accessionNo: "a" }, "a")).toBe(true);
    expect(accessionMatches({ accessionNo: "b" }, "a")).toBe(false);
    expect(accessionMatches({ accessionNo: "b" }, null)).toBe(true);
  });

  it("fails closed when the requested accession has no sources", () => {
    expect(() => assertAccessionTasks([], "missing")).toThrow("No cohort sources found for accession missing");
    expect(() => assertAccessionTasks([{}], "present")).not.toThrow();
  });

  it("retries only fallback statuses when explicitly requested", () => {
    expect(shouldResumeCohortEntry({ status: "extracted" }, false)).toBe(true);
    expect(shouldResumeCohortEntry({ status: "request_failed" }, false)).toBe(false);
    expect(shouldResumeCohortEntry({ status: "unparsed" }, false)).toBe(false);
    expect(shouldResumeCohortEntry({ status: "fallback" }, false)).toBe(true);
    expect(shouldResumeCohortEntry({ status: "fallback" }, true)).toBe(false);
    expect(shouldResumeCohortEntry({ status: "fallback_unverified" }, true)).toBe(false);
  });
});
