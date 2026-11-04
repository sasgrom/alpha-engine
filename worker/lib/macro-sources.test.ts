import { describe, expect, it } from "vitest";
import { MACRO_GROUP_ORDER, MACRO_SERIES, selectMacroSeries } from "./macro-sources";

describe("macro series registry", () => {
  it("registers VIXCLS as a separate volatility channel", () => {
    expect(MACRO_SERIES).toHaveLength(22);
    expect(MACRO_GROUP_ORDER).toContain("volatility");
    expect(selectMacroSeries("volatility", null)).toEqual([{ seriesId: "VIXCLS", group: "volatility", channel: "vix_close" }]);
    expect(selectMacroSeries(null, "vixcls")[0]?.group).toBe("volatility");
    expect(selectMacroSeries("rates", null).some((series) => series.seriesId === "VIXCLS")).toBe(false);
  });

  it("distinguishes monthly FEDFUNDS from daily DFF", () => {
    expect(selectMacroSeries(null, "FEDFUNDS")[0]).toMatchObject({ group: "rates", channel: "effective_federal_funds_monthly" });
    expect(selectMacroSeries(null, "DFF")[0]?.channel).toBe("effective_federal_funds");
    expect(selectMacroSeries(null, "FEDFUNDS")[0]?.seriesId).not.toBe(selectMacroSeries(null, "DFF")[0]?.seriesId);
  });
});
