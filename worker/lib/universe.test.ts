import { readFileSync } from "node:fs";
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

  it("keeps the presentation and worker manifests aligned", () => {
    const research = JSON.parse(readFileSync("worker/research-universe-50.json", "utf8")) as { cik: number; ticker: string }[];
    const worker = loadUniverse();
    const excluded = new Set(["XOM", "XOM_PRE", "RIVN", "ENLT"]);

    for (const universe of [research, worker]) {
      expect(universe).toHaveLength(50);
      expect(new Set(universe.map((company) => company.cik)).size).toBe(50);
      expect(new Set(universe.map((company) => company.ticker)).size).toBe(50);
      expect(universe.some((company) => excluded.has(company.ticker))).toBe(false);
      expect(universe.filter((company) => company.ticker === "CSCO")).toHaveLength(1);
      expect(universe.find((company) => company.ticker === "CSCO")?.cik).toBe(858877);
    }
    expect(worker.map((company) => company.ticker)).toEqual(research.map((company) => company.ticker));
    expect(worker.every((company) => company.name && company.gdeltQuery)).toBe(true);
  });
});
