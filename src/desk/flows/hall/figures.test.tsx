import { describe, expect, it } from "vitest";
import { bodyFor, decodePlaces, FIGURE_SIZE, figureScale, leaderAt, lookFor, outfitFor } from "./figures";

describe("who a fund is in the hall", () => {
  it("follows the leader in office at the quarter end", () => {
    // Vanguard: Tim Buckley until July 2024, Salim Ramji since
    expect(leaderAt(2100119, "2024-06-30")).toEqual({ name: "Tim Buckley", gender: "m" });
    expect(leaderAt(2100119, "2024-09-30")).toEqual({ name: "Salim Ramji", gender: "m" });
    // the earlier Vanguard filer is the same firm
    expect(leaderAt(102909, "2021-03-31")?.name).toBe("Tim Buckley");
    expect(leaderAt(315066, "2026-06-30")).toEqual({ name: "Abigail P. Johnson", gender: "f" });
    expect(leaderAt(1, "2026-06-30")).toBeNull();
  });

  it("dresses a fund by where its money stands and draws a mannequin when no source names the leader's gender", () => {
    expect(outfitFor("Information Technology")).toBe("tech");
    expect(outfitFor("Financials")).toBe("suit");
    expect(outfitFor("Health Care")).toBe("casual");
    expect(outfitFor(null)).toBe("casual");
    expect(bodyFor("m", "suit", 1)).toBe("man-suit");
    expect(bodyFor("f", "suit", 1)).toBe("woman");
    expect(bodyFor("f", "tech", 2)).toBe("woman-casual");
    expect(bodyFor(null, "tech", 2)).toBe("mannequin");
    expect(bodyFor(undefined, "suit", 2)).toBe("mannequin");
  });

  it("sizes people smaller than life on a log scale of the money, capped at both ends", () => {
    expect(figureScale(FIGURE_SIZE.from)).toBeCloseTo(FIGURE_SIZE.smallest, 12);
    expect(figureScale(FIGURE_SIZE.to)).toBeCloseTo(FIGURE_SIZE.largest, 12);
    // the very small and the very large stay at the caps
    expect(figureScale(0)).toBeCloseTo(FIGURE_SIZE.smallest, 12);
    expect(figureScale(6e12)).toBeCloseTo(FIGURE_SIZE.largest, 12);
    // the typical fund, $35 billion, is about seven tenths of a grown person, and ten times the money is visibly taller
    expect(figureScale(35e9)).toBeCloseTo(0.71, 2);
    expect(figureScale(350e9) - figureScale(35e9)).toBeGreaterThan(0.25);
  });

  it("gives every fund its own look, the same every time", () => {
    expect(lookFor(1067983)).toEqual(lookFor(1067983));
    const looks = [1067983, 102909, 2012383, 315066, 93751, 1364742, 1423053, 70858].map(lookFor);
    for (const look of looks) {
      for (const colour of [look.pants, look.shirt, look.hair, look.wood]) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
      expect(look.girth).toBeGreaterThanOrEqual(0.9);
      expect(look.girth).toBeLessThanOrEqual(1.12);
    }
    // not one uniform: eight funds wear more than two kinds of trousers and come in different builds
    expect(new Set(looks.map((look) => look.pants)).size).toBeGreaterThan(2);
    expect(new Set(looks.map((look) => look.girth.toFixed(2))).size).toBeGreaterThan(4);
  });

  it("reads the compact places of a quarter", () => {
    const places = decodePlaces({ places: [[7, 1, 0, 120, 2, 55], [8, -1]] }, ["Information Technology", "Energy", "Financials"]);
    expect(places.get(7)).toEqual({ home: "Energy", stakes: [{ sector: "Information Technology", weight: 0.12 }, { sector: "Financials", weight: 0.055 }] });
    expect(places.get(8)).toEqual({ home: null, stakes: [] });
  });
});
