import { describe, expect, it } from "vitest";
import { isUsListing, ratioText, readSplitCalendar, splitCalendarQuery } from "./split-calendar";

// the shape of Yahoo's answer, with rows as returned on 2026-11-13
const answer = {
  finance: { result: [{ documents: [{
    columns: [{ id: "ticker" }, { id: "companyshortname" }, { id: "startdatetime" }, { id: "optionable" }, { id: "old_share_worth" }, { id: "share_worth" }],
    rows: [
      ["HUBC", "Hub Cyber Security Ltd", "2026-11-13T05:00:00.000Z", false, 20, 1],
      ["0381.HK", "AOM International Group Co Ltd", "2026-11-13T05:00:00.000Z", false, 2, 1],
      ["NVDA", "NVIDIA Corporation", "2026-12-01T05:00:00.000Z", true, 1, 4],
      ["BRK-B", "Berkshire Hathaway Inc", "2026-12-02T05:00:00.000Z", true, 1, 2],
      ["BAD", "No share counts", "2026-12-03T05:00:00.000Z", false, null, 1],
    ],
  }] }] },
};

describe("Yahoo's split calendar", () => {
  it("asks for splits between two dates, sorted by date, one page at a time", () => {
    const body = splitCalendarQuery("2026-11-13", "2027-01-12", 250);
    expect(body.entityIdType).toBe("splits");
    expect(body.query.operands).toEqual([{ operator: "gte", operands: ["startdatetime", "2026-11-13"] }, { operator: "lt", operands: ["startdatetime", "2027-01-12"] }]);
    expect(body.offset).toBe(250);
  });

  it("reads rows by column name and computes new shares per old share", () => {
    const splits = readSplitCalendar(answer);
    expect(splits.map((split) => [split.ticker, split.date, split.ratio])).toEqual([
      ["HUBC", "2026-11-13", 0.05], ["0381.HK", "2026-11-13", 0.5], ["NVDA", "2026-12-01", 4], ["BRK-B", "2026-12-02", 2],
    ]);
    expect(ratioText(splits[0])).toBe("1-for-20");
    expect(ratioText(splits[2])).toBe("4-for-1");
    expect(readSplitCalendar({})).toEqual([]);
  });

  it("keeps US listings and drops other exchanges", () => {
    expect(["HUBC", "0381.HK", "PASHUPATI.NS", "EFY.MU", "BRK-B", "NVDA"].filter(isUsListing)).toEqual(["HUBC", "BRK-B", "NVDA"]);
  });
});
