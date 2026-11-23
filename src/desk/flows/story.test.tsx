import { describe, expect, it } from "vitest";
import { FLOW_OUTSIDE, type FlowQuarter } from "@contracts/fund-flows";
import { FLOWS_OVERVIEW } from "./flows-fixtures";
import { quarterStory } from "./story";

const row = FLOWS_OVERVIEW.quarters.at(-1)!;

describe("the walk through a quarter", () => {
  it("opens on the whole quarter and explains what a ribbon is", () => {
    const [first] = quarterStory(row);
    expect(first.id).toBe("quarter");
    expect(first.go).toEqual({ view: "overview" });
    expect(first.text).toBe("3 funds bought $90.00B and sold $70.00B of the covered stocks.");
    expect(first.hint).toContain("red at the end where it was sold, blue where it was bought");
  });

  it("goes to the sector that took in most and the one that lost most, naming the widest ribbons", () => {
    const steps = quarterStory(row);
    const into = steps.find((step) => step.id === "into")!;
    const out = steps.find((step) => step.id === "out")!;
    expect(into.go).toEqual({ sector: "Information Technology" });
    expect(into.title).toBe("Most money went into Information Technology");
    expect(into.text).toContain("took in +$40.00B net");
    expect(out.go).toEqual({ sector: "Energy" });
    expect(out.text).toContain("lost −$20.00B net");
  });

  it("never names a sector as the source of its own ribbon", () => {
    const within: FlowQuarter = { ...row, rotation: [{ from: "Information Technology", to: "Information Technology", usd: 99e9 }, { from: "Energy", to: "Information Technology", usd: 7e9 }] };
    const into = quarterStory(within).find((step) => step.id === "into")!;
    expect(into.text).toContain("come from Energy ($7.00B).");
    expect(into.text).not.toContain("$99.00B");
  });

  it("faces the doorway for money from and to outside, and says it is an estimate", () => {
    const outside: FlowQuarter = { ...row, rotation: [{ from: FLOW_OUTSIDE, to: "Energy", usd: 12e9 }, { from: "Energy", to: FLOW_OUTSIDE, usd: 5e9 }] };
    const door = quarterStory(outside).find((step) => step.id === "outside")!;
    expect(door.go).toEqual({ view: "door" });
    expect(door.text).toBe("$12.00B of new money came in from outside the covered stocks and $5.00B left: cash, bonds and other shares.");
    expect(door.hint.startsWith("An estimate.")).toBe(true);
  });

  it("ends on the most bought and the most sold company, with names when they are known", () => {
    const steps = quarterStory(row, new Map([[34088, "Exxon Mobil"]]));
    const sold = steps.at(-1)!;
    expect(sold.id).toBe("sold");
    expect(sold.go).toEqual({ company: 34088 });
    expect(sold.title).toBe("Most sold: XOM");
    expect(sold.text).toContain("Exxon Mobil (XOM) lost −$20.00B net: 2 funds sold $25.00B, 1 bought $5.00B.");
    expect(steps.some((step) => step.id === "bought")).toBe(true);
  });
});
