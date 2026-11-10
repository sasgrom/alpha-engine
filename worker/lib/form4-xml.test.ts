import { describe, expect, it } from "vitest";
import { parseForm4Xml } from "./form4-xml";
import { form4ExclusionReason, supersedeForm4Transactions } from "./form4-features";
import { form4FixtureXml } from "./form4-test-fixtures";
import { parseSecAcceptanceDateTime } from "./form4-core";

const context = {
  accessionNo: "0000000000-26-000001",
  form: "4",
  availableAt: "2026-10-10 16:30:00",
  issuerCik: 50863,
  ticker: "INTC",
  periodOfReport: "2026-10-01",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/50863/000000000026000001/form4.xml",
  inputSha256: "fixture",
};

describe("Form 4 ownership XML parser", () => {
  it("parses transactions, roles, indirect ownership and footnotes without raw XML", () => {
    const rows = parseForm4Xml(form4FixtureXml(), context);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ transactionCode: "P", valueUsd: 2500, directOrIndirect: "D", natureOfOwnership: "By Trust", isDirector: true, isOfficer: true, isTenPercentOwner: false, officerTitle: "Chief Financial Officer", percentOwnedAfter: null });
    expect(rows[0].footnotes).toEqual(["Open-market execution footnote"]);
    expect(rows[0]).not.toHaveProperty("rawXml");
    expect(form4ExclusionReason(rows[0])).toBeNull();
    expect(rows.slice(1).map(form4ExclusionReason)).toEqual(["award", "option_exercise", "rsu_tax_withholding", "gift", "sale"]);
  });

  it("keeps first-available original and amendment separately while deduping identical rows", () => {
    const original = parseForm4Xml(form4FixtureXml(["P"]), context);
    const amended = parseForm4Xml(form4FixtureXml(["P"], true), { ...context, form: "4/A", accessionNo: "0000000000-26-000002", availableAt: "2026-10-11 16:30:00" });
    const rows = supersedeForm4Transactions([...original, ...original, ...amended]);
    expect(rows).toHaveLength(2);
    expect(rows[0].accessionNo).toBe("0000000000-26-000001");
    expect(rows[0].isAmendment).toBe(false);
    expect(rows[1].accessionNo).toBe("0000000000-26-000002");
    expect(rows[1].isAmendment).toBe(true);
    expect(rows[1].amendmentOf).toBe("0000000000-26-000001");
  });

  it("skips a different issuer but rejects invalid ownership XML", () => {
    expect(parseForm4Xml(form4FixtureXml(["P"]), { ...context, issuerCik: 1 })).toEqual([]);
    expect(() => parseForm4Xml("<html/>", context)).toThrow("ownershipDocument");
  });

  it("keeps transaction dates scalar when value contains a footnote reference", () => {
    const xml = form4FixtureXml(["P"]).replace("<transactionDate><value>2026-10-01</value></transactionDate>", "<transactionDate><value>2026-10-01</value><footnoteId id=\"F1\"/></transactionDate>");
    const rows = parseForm4Xml(xml, context);
    expect(rows[0].eventTs).toBe("2026-10-01");
    expect(Number.isFinite(Date.parse(rows[0].eventTs))).toBe(true);
  });

  it("uses the official SEC acceptance header instead of a midnight fallback", () => {
    expect(parseSecAcceptanceDateTime("<SEC-HEADER><ACCEPTANCE-DATETIME>20240130165654</SEC-HEADER>")).toBe("2024-01-30 16:56:54");
    expect(() => parseSecAcceptanceDateTime("<SEC-HEADER/>")).toThrow("acceptance datetime");
  });
});
