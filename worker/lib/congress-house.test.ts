import { describe, expect, it } from "vitest";
import { housePtrUrl, isoDate, parseHouseIndex } from "./congress-house";

describe("House disclosure index", () => {
  it("parses PTR identity, state/district, entities and dates", () => {
    const xml = `<?xml version="1.0"?><FinancialDisclosure><Member><DocID>10012345</DocID><Year>2025</Year><FilingDate>2/3/2026</FilingDate><FilingType>P</FilingType><FirstName>A &amp; B</FirstName><LastName>Example</LastName><StateDst>VA07</StateDst></Member><Member><DocID>10012346</DocID><Year>2025</Year><FilingDate>2026-02-04</FilingDate><FilingType>A</FilingType><FirstName>Other</FirstName><LastName>Member</LastName><StateDst>NY</StateDst></Member></FinancialDisclosure>`;
    expect(parseHouseIndex(xml, 2025)).toEqual([
      { docId: "10012345", year: 2025, member: "A & B Example", firstName: "A & B", lastName: "Example", state: "VA", district: "07", filingType: "P", filedDate: "2026-02-03" },
      { docId: "10012346", year: 2025, member: "Other Member", firstName: "Other", lastName: "Member", state: "NY", district: null, filingType: "A", filedDate: "2026-02-04" },
    ]);
    expect(housePtrUrl(2025, "10012345")).toBe("https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2025/10012345.pdf");
  });

  it("deduplicates exact repeats and fails closed on a wrong year, conflict or impossible date", () => {
    const record = (id: string, date = "1/2/2026") => `<Member><DocID>${id}</DocID><Year>2025</Year><FilingDate>${date}</FilingDate><FilingType>P</FilingType><FirstName>A</FirstName><LastName>B</LastName><StateDst>CA01</StateDst></Member>`;
    expect(() => parseHouseIndex(record("1"), 2024)).toThrow("does not match");
    expect(parseHouseIndex(`${record("1")}${record("1")}`, 2025)).toHaveLength(1);
    expect(() => parseHouseIndex(`${record("1")}${record("1", "1/3/2026")}`, 2025)).toThrow("conflicting");
    expect(() => isoDate("2/30/2026")).toThrow("Invalid House filing date");
  });

  it("uses the older First/Last tags and retains blank dates on non-PTR records", () => {
    const xml = "<Member><DocID>7</DocID><Year>2013</Year><FilingDate /><FilingType>W</FilingType><First>John</First><Last>Example</Last><StateDst>LA05</StateDst></Member>";
    expect(parseHouseIndex(xml, 2013)[0]).toMatchObject({ member: "John Example", filedDate: null, filingType: "W" });
    expect(() => parseHouseIndex(xml.replace("FilingType>W", "FilingType>T"), 2013)).toThrow("has no filing date");
  });
});
