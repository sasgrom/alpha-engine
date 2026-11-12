import { describe, expect, it } from "vitest";
import { FLOWS_OVERVIEW } from "../flows-fixtures";
import { topLists } from "./lists";

const row = FLOWS_OVERVIEW.quarters[1];

describe("the top-ten boards", () => {
  it("fills the lists of the quarter and points each row at its company or fund", () => {
    const lists = topLists(FLOWS_OVERVIEW, row, "flow", "all");
    expect(lists[0].title).toBe("Most bought");
    expect(lists[0].rows[0]).toEqual({ label: "NVDA · Nvidia", value: "+$30.0bn", tone: "in", target: { kind: "company", id: 1045810 } });
    const sold = lists.find((list) => list.title === "Most sold")!;
    expect(sold.rows[0].value).toBe("−$20.0bn");
    const buyers = lists.find((list) => list.title === "Top buyers")!;
    expect(buyers.rows[0]).toMatchObject({ label: "BlackRock", tone: "in", target: { kind: "fund", id: 2012383 } });
    // winners and losers against all funds' 4%: Citadel's 9% wins, Berkshire's 1% loses, BlackRock's 4% is neither
    expect(lists.find((list) => list.title === "Winners")!.rows.map((item) => item.label)).toEqual(["Citadel Advisors"]);
    expect(lists.find((list) => list.title === "Losers")!.rows.map((item) => item.label)).toEqual(["Berkshire Hathaway"]);
    // no list is empty
    for (const list of lists) expect(list.rows.length).toBeGreaterThan(0);
  });

  it("orders the boards by the view and puts the switch's own list first", () => {
    expect(topLists(FLOWS_OVERVIEW, row, "outcome", "all")[0].title).toBe("Best since");
    expect(topLists(FLOWS_OVERVIEW, row, "held", "all")[0].title).toBe("Largest holdings");
    expect(topLists(FLOWS_OVERVIEW, row, "flow", "losers")[0].title).toBe("Losers");
  });
});
