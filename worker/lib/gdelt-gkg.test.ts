import { describe, expect, it } from "vitest";
import { buildIndex, companiesOf, parseGkg, parseLastUpdate, slotsBetween, stampIso } from "./gdelt-gkg";

const LAST = `88390 e79e28222bd59353fd09ed4379f43be7 http://data.gdeltproject.org/gdeltv2/20261126011500.export.CSV.zip
84179 385d4490f44f79becd8770a7cc722d26 http://data.gdeltproject.org/gdeltv2/20261126011500.mentions.CSV.zip
4424684 7767139332819065419c322fb6963370 http://data.gdeltproject.org/gdeltv2/20261126011500.gkg.csv.zip`;

const row = (fields: Record<number, string>) => Array.from({ length: 27 }, (_, i) => fields[i] ?? "").join("\t");
const GKG = [
  row({ 0: "20261126011500-1", 1: "20261126011500", 3: "dailyrecordnews.com", 4: "https://dailyrecordnews.com/microsoft-outage", 7: "ECON_STOCKMARKET,12;TAX_FNCACT,40", 13: "microsoft,120;cloudflare,300", 15: "-8.45,1.2,9.6,10.8,20,0,1200", 26: "<PAGE_TITLE>Microsoft explains tech failures that triggered global outage</PAGE_TITLE>" }),
  row({ 0: "20261126011500-2", 1: "20261126011500", 3: "usmagazine.com", 4: "https://usmagazine.com/shows", 13: "", 15: "1.02,3,2,5,10,0,900", 26: "<PAGE_TITLE>15 Shows to Watch This Thanksgiving</PAGE_TITLE>" }),
  "too\tshort",
].join("\n");

describe("GDELT GKG files", () => {
  it("reads the GKG line of lastupdate.txt and asks it over HTTPS", () => {
    expect(parseLastUpdate(LAST)).toEqual({ size: 4424684, md5: "7767139332819065419c322fb6963370", url: "https://data.gdeltproject.org/gdeltv2/20261126011500.gkg.csv.zip", stamp: "20261126011500" });
    expect(parseLastUpdate("nothing here")).toBeNull();
  });

  it("lists the 15-minute slots after the last one stored, across midnight", () => {
    expect(slotsBetween("20261125233000", "20261126001500")).toEqual(["20261125234500", "20261126000000", "20261126001500"]);
    expect(slotsBetween("20261126001500", "20261126001500")).toEqual([]);
    expect(stampIso("20261126011500")).toBe("2026-11-26T01:15:00.000Z");
  });

  it("parses records with title, tone, organizations and themes, and skips broken lines", () => {
    const records = parseGkg(GKG);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ id: "20261126011500-1", gdeltAt: "2026-11-26T01:15:00.000Z", source: "dailyrecordnews.com", title: "Microsoft explains tech failures that triggered global outage", tone: -8.45, positive: 1.2, negative: 9.6, words: 1200, organizations: ["microsoft", "cloudflare"], themes: ["ECON_STOCKMARKET", "TAX_FNCACT"] });
    expect(records[1].organizations).toEqual([]);
  });

  it("ties an organization to one company of our index, and none when it is unclear", () => {
    const index = buildIndex([{ cik: 789019, tickers: ["MSFT"], names: ["MICROSOFT CORP"] }, { cik: 1, tickers: ["ACME"], names: ["Acme Corp"] }, { cik: 2, tickers: ["ACMX"], names: ["Acme Inc"] }]);
    const [record] = parseGkg(GKG);
    expect(companiesOf(record, index)).toEqual([{ cik: 789019, ticker: "MSFT", organization: "microsoft", match: "exact" }]);
    expect(companiesOf({ ...record, organizations: ["acme"] }, index)).toEqual([]);
  });
});
