import { describe, expect, it } from "vitest";
import { chunkFigiIds, FIGI_MAX_429_RETRIES, FIGI_MAX_JOBS_PER_REQUEST, formatFigiError, shouldRetryFigi429 } from "./figi";

describe("OpenFIGI request guardrails", () => {
  it("chunks mapping jobs at exactly the provider maximum", () => {
    expect(FIGI_MAX_JOBS_PER_REQUEST).toBe(10);
    const chunks = chunkFigiIds(Array.from({ length: 23 }, (_, index) => `CUSIP${index}`));
    expect(chunks.map((chunk) => chunk.items.length)).toEqual([10, 10, 3]);
    expect(chunks.map((chunk) => chunk.start)).toEqual([0, 10, 20]);
  });

  it("iterates chunks as { start, items } records used by the refresh runner", () => {
    const chunks = chunkFigiIds(["037833100", "67066G104", "857477103"], 2);
    const [index, { start, items: chunk }] = chunks.entries().next().value;
    expect(index).toBe(0);
    expect(start).toBe(0);
    expect(chunk).toEqual(["037833100", "67066G104"]);
    const [, second] = chunks;
    expect(second.start).toBe(2);
    expect(second.items).toEqual(["857477103"]);
  });

  it("rejects oversized or invalid chunks instead of issuing HTTP 413", () => {
    expect(() => chunkFigiIds(["A"], 11)).toThrow("FIGI chunk size");
    expect(() => chunkFigiIds(["A"], 0)).toThrow("FIGI chunk size");
  });

  it("allows only two 429 retries", () => {
    expect(FIGI_MAX_429_RETRIES).toBe(2);
    expect(shouldRetryFigi429(0)).toBe(true);
    expect(shouldRetryFigi429(1)).toBe(true);
    expect(shouldRetryFigi429(2)).toBe(false);
    expect(shouldRetryFigi429(3)).toBe(false);
  });

  it("surfaces the underlying SQL cause and chunk metadata without raw DDL", () => {
    const message = formatFigiError(
      { message: "Failed query: INSERT INTO cusip_map …", cause: { message: "ER_DATA_TOO_LONG", code: "ER_DATA_TOO_LONG", errno: 1406, sqlState: "22001" } },
      { start: 20, size: 10, firstCusips: ["037833100", "67066G104", "857477103"] },
    );
    expect(message).toContain("ER_DATA_TOO_LONG");
    expect(message).toContain("errno=1406");
    expect(message).toContain("sqlState=22001");
    expect(message).toContain("chunkStart=20");
    expect(message).toContain("chunkSize=10");
    expect(message).toContain("037833100");
    expect(message).not.toContain("INSERT INTO cusip_map");
  });

  it("keeps ordinary HTTP errors visible with request context", () => {
    const message = formatFigiError(new Error("figi HTTP 429 after 2 retries"), { start: 0, size: 10, firstCusips: ["037833100"] });
    expect(message).toContain("figi HTTP 429 after 2 retries");
    expect(message).toContain("chunkStart=0");
  });
});
