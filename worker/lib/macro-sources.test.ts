import { describe, expect, it } from "vitest";
import { MACRO_GROUP_ORDER, MACRO_SERIES, selectMacroSeries } from "./macro-sources";

describe("macro series registry", () => {
  it("registers VIXCLS as a separate volatility channel", () => {
    expect(MACRO_SERIES).toHaveLength(21);
    expect(MACRO_GROUP_ORDER).toContain("volatility");
    expect(selectMacroSeries("volatility", null)).toEqual([{ seriesId: "VIXCLS", group: "volatility", channel: "vix_close" }]);
    expect(selectMacroSeries(null, "vixcls")[0]?.group).toBe("volatility");
    expect(selectMacroSeries("rates", null).some((series) => series.seriesId === "VIXCLS")).toBe(false);
  });
});
