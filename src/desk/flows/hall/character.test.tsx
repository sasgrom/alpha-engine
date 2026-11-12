import { describe, expect, it } from "vitest";
import { ageFor, characterFor, firstFiledOf } from "./character";

describe("age, build and what people carry", () => {
  it("dates a firm by its first SEC filing, an earlier filer of the same firm included", () => {
    const filed = new Map<number, string | null>([[2012383, "2024-03-01"], [1364742, "1995-02-10"], [5, "2018-05-01"], [6, null]]);
    // BlackRock files under a new number since 2024 but has been on EDGAR since 1995
    expect(firstFiledOf(2012383, filed)).toBe("1995-02-10");
    expect(firstFiledOf(5, filed)).toBe("2018-05-01");
    expect(firstFiledOf(6, filed)).toBeNull();
    expect(firstFiledOf(7, filed)).toBeNull();
    expect(ageFor("1994-01-01")).toBe("senior");
    expect(ageFor("1996-12-31")).toBe("senior");
    expect(ageFor("2009-06-30")).toBe("middle");
    expect(ageFor("2012-01-01")).toBe("young");
    expect(ageFor(null)).toBe("middle");
  });

  it("gives the old firms grey hair and some a cane, the young ones scooters and bikes, the large ones a broader build", () => {
    const seniors = Array.from({ length: 200 }, (_, index) => characterFor(1000 + index, "1994-05-01", 0.5, false, false));
    expect(seniors.every((person) => person.hair !== null)).toBe(true);
    const canes = seniors.filter((person) => person.carry === "cane").length;
    expect(canes).toBeGreaterThan(40);
    expect(canes).toBeLessThan(110);
    expect(seniors.filter((person) => person.carry === "cane").every((person) => person.pace < 1)).toBe(true);
    const young = Array.from({ length: 200 }, (_, index) => characterFor(5000 + index, "2019-01-01", 0.2, false, false));
    expect(young.some((person) => person.carry === "scooter")).toBe(true);
    expect(young.some((person) => person.carry === "bike")).toBe(true);
    expect(young.every((person) => person.carry !== "cane" && person.hair === null)).toBe(true);
    // the staff carry nothing; technology holders without a ride carry laptops
    expect(characterFor(1001, "1994-05-01", 1, true, true).carry).toBeNull();
    const tech = Array.from({ length: 100 }, (_, index) => characterFor(9000 + index, "2003-01-01", 0.5, true, false));
    expect(tech.some((person) => person.carry === "laptop")).toBe(true);
    // size makes the build: the largest funds are broader than the smallest
    expect(characterFor(42, "2003-01-01", 1, false, false).girth).toBeGreaterThan(characterFor(42, "2003-01-01", 0, false, false).girth + 0.2);
    // the same every time
    expect(characterFor(42, "2003-01-01", 0.4, true, false)).toEqual(characterFor(42, "2003-01-01", 0.4, true, false));
  });
});
