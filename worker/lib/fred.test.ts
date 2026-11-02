import { describe, expect, it } from "vitest";
import { fetchFredText, normalizeFredObservations, redactFredSecrets, type FredSeriesMetadata } from "./fred";
import { selectMacroSeries } from "./macro-sources";

const metadata: FredSeriesMetadata = { id: "GDP", title: "GDP", frequency: "Quarterly", units: "Billions", seasonal_adjustment: "SAAR", last_updated: "2026-10-30" };
const observation = (realtimeStart: string, realtimeEnd: string, value: string) => ({ realtime_start: realtimeStart, realtime_end: realtimeEnd, date: "2026-07-01", value });

describe("FRED vintage normalization", () => {
  it("preserves revisions separately and does not invent an original release timestamp", () => {
    const rows = normalizeFredObservations("GDP", [observation("2026-08-27", "2026-09-28", "100"), observation("2026-09-29", "9999-12-31", "101.5")], metadata, "abc", "2026-10-30T12:00:00Z");
    expect(rows).toHaveLength(2);
    expect(rows[0].releasedAt).toBeNull();
    expect(rows[0].availablePrecision).toBe("day");
    expect(rows[0].researchEligibleAt).toBe("2026-08-27T23:59:59.999Z");
    expect(rows[0].supersededAt).toBe("2026-09-28T23:59:59.999Z");
    expect(rows[1].supersededAt).toBeNull();
    expect(rows[0].vintageId).not.toBe(rows[1].vintageId);
  });

  it("keeps missing values as null and rejects duplicate vintages", () => {
    const rows = normalizeFredObservations("GDP", [observation("2026-08-27", "9999-12-31", ".")], metadata, "abc", "2026-10-30T12:00:00Z");
    expect(rows[0].value).toBeNull();
    expect(() => normalizeFredObservations("GDP", [observation("2026-08-27", "9999-12-31", "1"), observation("2026-08-27", "9999-12-31", "2")], metadata, "abc", "2026-10-30T12:00:00Z")).toThrow("Duplicate FRED vintage");
  });

  it("builds the official JSON endpoint without exposing the key in returned data", async () => {
    const original = globalThis.fetch;
    let requestUrl = "";
    globalThis.fetch = async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ observations: [] }), { status: 200 });
    };
    try {
      const text = await fetchFredText("series/observations", { series_id: "GDP", output_type: "3" }, "abcdefghijklmnopqrstuvwxyz123456");
      expect(JSON.parse(text)).toEqual({ observations: [] });
      expect(requestUrl).toContain("https://api.stlouisfed.org/fred/series/observations?");
      expect(requestUrl).toContain("output_type=3");
      expect(requestUrl).toContain("file_type=json");
      expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("redacts the API key from failures", () => {
    expect(redactFredSecrets("HTTP 403 api_key=secret123&x=1 secret123", "secret123")).not.toContain("secret123");
  });

  it("uses the documented collection order and deliberate groups", () => {
    expect(selectMacroSeries(null, null).every((series) => series.group === "rates")).toBe(true);
    expect(selectMacroSeries("oil", null).map((series) => series.seriesId)).toEqual(["DCOILWTICO", "DCOILBRENTEU"]);
    expect(selectMacroSeries("all", null).length).toBeGreaterThan(15);
  });
});
