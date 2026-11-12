import { describe, expect, it } from "vitest";
import { nextVisits, stayFor, type Visitor } from "./visits";

const visitors: Visitor[] = [
  { cik: 30, stakes: [{ sector: "Energy", weight: 0.02 }] },
  { cik: 10, stakes: [{ sector: "Financials", weight: 0.03 }, { sector: "Health Care", weight: 0.08 }] },
  { cik: 20, stakes: [] },
  { cik: 40, stakes: [{ sector: "Utilities", weight: 0.05 }] },
];

describe("visits to other bookcases", () => {
  it("sends only funds with a stake elsewhere, never one already on its way, and everybody in turn", () => {
    const first = nextVisits(visitors, new Set(), 0, 2);
    expect(first.map((visit) => visit.cik)).toEqual([10, 30]);
    expect(nextVisits(visitors, new Set([10]), 0, 2).map((visit) => visit.cik)).toEqual([30, 40]);
    // the next round starts further on, so the third fund gets its turn
    expect(nextVisits(visitors, new Set(), 1, 2).map((visit) => visit.cik)).toEqual([40, 10]);
    expect(nextVisits(visitors, new Set(), 0, 0)).toEqual([]);
    expect(nextVisits([{ cik: 1, stakes: [] }], new Set(), 3, 4)).toEqual([]);
  });

  it("goes to a fund's largest stake most often, and to the others too", () => {
    const sectors = Array.from({ length: 30 }, (_, round) => nextVisits([visitors[1]], new Set(), round, 1)[0].sector);
    const count = (sector: string) => sectors.filter((item) => item === sector).length;
    expect(count("Health Care")).toBe(20);
    expect(count("Financials")).toBe(10);
  });

  it("stays seven to eleven seconds, the same for a fund every time", () => {
    for (const cik of [1, 102909, 1067983, 2012383]) {
      expect(stayFor(cik)).toBeGreaterThanOrEqual(7);
      expect(stayFor(cik)).toBeLessThan(11);
      expect(stayFor(cik)).toBe(stayFor(cik));
    }
  });
});
