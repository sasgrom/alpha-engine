import { describe, expect, it } from "vitest";
import path from "node:path";
import { CACHE_ROOT, CODE_ROOT, form4CacheRoot, form4QaRunsRoot, RUNS_ROOT } from "./cache-root";

describe("canonical Form 4 cache roots", () => {
  it("keeps Form 4 cache under one cache root", () => {
    expect(form4CacheRoot()).toBe(path.join(CACHE_ROOT, "edgar-form4"));
    expect(path.isAbsolute(form4CacheRoot())).toBe(true);
  });

  it("keeps QA summaries under one runs root", () => {
    expect(form4QaRunsRoot()).toBe(path.join(RUNS_ROOT, "form4-qa"));
    expect(path.isAbsolute(form4QaRunsRoot())).toBe(true);
    expect(CODE_ROOT).toBe(path.resolve(import.meta.dirname, "../.."));
  });
});
