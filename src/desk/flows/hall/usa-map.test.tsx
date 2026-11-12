import { describe, expect, it } from "vitest";
import { decodeArcs, decodeStates, FIPS_STATES, onTable, ringArea, ringOf, TABLE, type UsaTopology } from "./usa-map";

/** Two squares side by side sharing one border, as a topology stores them: Kansas west of Missouri. */
const topology: UsaTopology = {
  transform: { scale: [1, 1], translate: [100, 200] },
  arcs: [
    // the shared border, north to south: (10,0) → (10,10)
    [[10, 0], [0, 10]],
    // Kansas's other three sides: (10,10) → (0,10) → (0,0) → (10,0)
    [[10, 10], [-10, 0], [0, -10], [10, 0]],
    // Missouri's other three sides: (10,0) → (20,0) → (20,10) → (10,10)
    [[10, 0], [10, 0], [0, 10], [-10, 0]],
  ],
  objects: {
    states: {
      geometries: [
        { id: "20", type: "Polygon", arcs: [[0, 1]], properties: { name: "Kansas" } },
        { id: "29", type: "Polygon", arcs: [[2, -1]], properties: { name: "Missouri" } },
        { id: "99", type: "Polygon", arcs: [[0, 1]], properties: { name: "Not a state" } },
      ],
    },
    nation: { geometries: [] },
  },
};

describe("the map table", () => {
  it("knows the fifty states and the District by their FIPS codes", () => {
    expect(Object.keys(FIPS_STATES)).toHaveLength(51);
    expect(new Set(Object.values(FIPS_STATES)).size).toBe(51);
    expect(FIPS_STATES["48"]).toBe("TX");
    expect(FIPS_STATES["11"]).toBe("DC");
  });

  it("decodes the delta-coded arcs and joins them into rings, a negative index walking an arc backwards", () => {
    const arcs = decodeArcs(topology);
    expect(arcs[0]).toEqual([[110, 200], [110, 210]]);
    expect(ringOf(arcs, [0, 1])).toEqual([[110, 200], [110, 210], [100, 210], [100, 200], [110, 200]]);
    // Missouri walks the shared border backwards, south to north
    expect(ringOf(arcs, [2, -1])).toEqual([[110, 200], [120, 200], [120, 210], [110, 210], [110, 200]]);
    const { area, centre } = ringArea(ringOf(arcs, [2, -1]));
    expect(Math.abs(area)).toBeCloseTo(100, 9);
    expect(centre[0]).toBeCloseTo(115, 9);
    expect(centre[1]).toBeCloseTo(205, 9);
  });

  it("gives every state its outline and a place for its flag, and leaves out what is not a state", () => {
    const states = decodeStates(topology);
    expect(states.map((state) => [state.code, state.name])).toEqual([["KS", "Kansas"], ["MO", "Missouri"]]);
    expect(states[0].anchor[0]).toBeCloseTo(105, 9);
    expect(states[1].anchor[0]).toBeCloseTo(115, 9);
  });

  it("lays the map on the table with north away from the entrance", () => {
    const north = onTable([487.5, 0]);
    const south = onTable([487.5, 610]);
    expect(north.z).toBeLessThan(0);
    expect(south.z).toBeGreaterThan(0);
    expect(north.x).toBeCloseTo(0, 9);
    expect(north.y).toBe(TABLE.top);
    // the map is about ten metres from coast to coast
    expect(onTable([975, 300]).x - onTable([0, 300]).x).toBeCloseTo(10.2, 6);
  });
});
