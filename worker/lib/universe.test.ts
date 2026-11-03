import { describe, expect, it } from "vitest";
import { loadUniverse } from "./universe";

describe("worker universe loader", () => {
  it("loads the committed Stocktwits universe snapshot", () => {
    const universe = loadUniverse();

    expect(universe).toEqual(expect.arrayContaining([
      expect.objectContaining({ cik: 320193, ticker: "AAPL", name: "Apple Inc." }),
      expect.objectContaining({ cik: 1045810, ticker: "NVDA" }),
    ]));
    expect(universe.every((company) => company.cik > 0 && company.ticker.length > 0)).toBe(true);
  });
});
