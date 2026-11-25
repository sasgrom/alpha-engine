import { describe, expect, it } from "vitest";
import { CompanyIndex, explicitTickers, nameKey } from "./news-companies";

const index = new CompanyIndex([
  { cik: 6281, tickers: ["ADI"], names: ["ANALOG DEVICES INC"] },
  { cik: 4977, tickers: ["AFL"], names: ["AFLAC INC"] },
  { cik: 1113169, tickers: ["TROW"], names: ["PRICE T ROWE GROUP INC", "T. Rowe Price Group, Inc."] },
  { cik: 1652044, tickers: ["GOOGL", "GOOG"], names: ["Alphabet Inc."] },
  { cik: 891103, tickers: ["MTCH"], names: ["Match Group, Inc.", "IAC/InterActiveCorp"] },
  { cik: 1575189, tickers: [], names: ["Match Group, Inc."], status: "former" },
  { cik: 320193, tickers: ["AAPL"], names: ["Apple Inc."] },
  { cik: 1067983, tickers: ["BRK.B", "BRK.A"], names: ["BERKSHIRE HATHAWAY INC"] },
]);

describe("company names in news", () => {
  it("normalizes legal forms, punctuation and articles", () => {
    expect(nameKey("Analog Devices, Inc.")).toBe("analog devices");
    expect(nameKey("The Trade Desk, Inc.")).toBe(nameKey("TRADE DESK INC THE"));
    expect(nameKey("AT&T Inc.")).toBe("at and t");
  });

  it("reads tickers the text states with an exchange", () => {
    expect(explicitTickers("RingCentral (NYSE:RNG) is looking ... Dynatrace (NYSE: DT) and Anthropic PBC (NASDAQ:ANT)")).toEqual(["RNG", "DT", "ANT"]);
    expect(explicitTickers("Berkshire (NYSE: BRK-B) and nothing else in CAPS")).toEqual(["BRK.B"]);
  });

  it("resolves press names, inverted filer names and brand aliases", () => {
    expect(index.resolve("Analog Devices")?.tickers).toEqual(["ADI"]);
    expect(index.resolve("Aflac Incorporated")?.cik).toBe(4977);
    expect(index.resolve("T Rowe Price Group Inc")?.cik).toBe(1113169);
    expect(index.resolve("Google")?.cik).toBe(1652044);
    expect(index.resolve("Apple")?.cik).toBe(320193);
    expect(index.resolve("Berkshire")?.cik).toBe(1067983);
  });

  it("returns no single answer for two equally good companies, but lists both", () => {
    expect(index.resolve("Match Group")).toBeNull();
    expect(index.candidates("Match Group").map(row => row.cik).sort((a, b) => a - b)).toEqual([891103, 1575189]);
  });

  it("prefers a ticker the text states, and finds nothing for an unknown name", () => {
    expect(index.resolve("Match Group", "MTCH")?.cik).toBe(891103);
    expect(index.resolve("Foundation Robotics")).toBeNull();
  });
});
