import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseForm4Xml } from "./form4-xml";
import { buildInsiderBuyClusters } from "./form4-features";
import { form4FixtureXml } from "./form4-test-fixtures";

function realRows(cik: number, ticker: string, accessionNo: string) {
  return parseForm4Xml(readFileSync(path.resolve("worker/test-fixtures/form4", `${cik}-${accessionNo}.xml`), "utf8"), {
    accessionNo,
    form: "4",
    availableAt: "2018-01-01 00:00:00",
    issuerCik: cik,
    ticker,
    periodOfReport: "2018-01-01",
    sourceUrl: "fixture",
    inputSha256: "fixture",
  });
}

describe("Form 4 multi-owner parsing", () => {
  it("parses all owners of the real LULU joint form without duplicating the transaction", () => {
    const rows = realRows(1397187, "LULU", "0001140361-18-028159");
    expect(rows).toHaveLength(1);
    expect(rows[0].multiOwner).toBe(true);
    expect(rows[0].owners).toHaveLength(5);
    expect(rows[0].owners?.every((owner) => owner.isTenPercentOwner)).toBe(true);
    expect(rows[0].ownerCik).toBe(1034196);
    expect(new Set(rows.map((row) => `${row.eventTs}|${row.transactionCode}|${row.shares}|${row.pricePerShare}`)).size).toBe(1);
  });

  it("parses MSFT roles and GS joint owners with multiOwner flags", () => {
    const msft = realRows(789019, "MSFT", "0001418812-17-000129");
    expect(msft[0].owners).toHaveLength(8);
    expect(msft[0].multiOwner).toBe(true);
    expect(msft[0].owners?.some((owner) => owner.isDirector)).toBe(true);
    expect(msft[0].owners?.some((owner) => owner.isOther)).toBe(true);
    const gs = realRows(886982, "GS", "0000769993-19-000566");
    expect(gs[0].owners).toHaveLength(2);
    expect(gs[0].multiOwner).toBe(true);
    expect(gs[0].owners?.every((owner) => owner.isTenPercentOwner)).toBe(true);
  });

  it("keeps the single-owner behavior as a regression", () => {
    const context = { accessionNo: "0000000000-26-000001", form: "4", availableAt: "2026-10-10 16:30:00", issuerCik: 50863, ticker: "INTC", periodOfReport: "2026-10-01", sourceUrl: "fixture", inputSha256: "fixture" };
    const rows = parseForm4Xml(form4FixtureXml(["P"]), context);
    expect(rows[0].multiOwner).toBe(false);
    expect(rows[0].owners).toHaveLength(1);
    expect(rows[0].owners?.[0]).toMatchObject({ ownerCik: rows[0].ownerCik, rptOwnerName: rows[0].rptOwnerName, isDirector: rows[0].isDirector, isOfficer: rows[0].isOfficer, isTenPercentOwner: rows[0].isTenPercentOwner, officerTitle: rows[0].officerTitle });
  });

  it("counts cluster identity both with and without multi-owner transactions", () => {
    const context = { accessionNo: "0000000000-26-000001", form: "4", availableAt: "2026-10-10 16:30:00", issuerCik: 50863, ticker: "INTC", periodOfReport: "2026-10-01", sourceUrl: "fixture", inputSha256: "fixture" };
    const secondOwner = "<reportingOwner><reportingOwnerId><rptOwnerCik>0000000002</rptOwnerCik><rptOwnerName>Joint Owner</rptOwnerName></reportingOwnerId><reportingOwnerAddress/><reportingOwnerRelationship><isTenPercentOwner>true</isTenPercentOwner></reportingOwnerRelationship></reportingOwner>";
    const xml = form4FixtureXml(["P"]).replace("</reportingOwner>", `</reportingOwner>${secondOwner}`);
    const rows = parseForm4Xml(xml, context);
    const { clusters } = buildInsiderBuyClusters(rows, { INTC: [] });
    expect(clusters[0]).toMatchObject({ multiOwner: true, multiOwnerTransactionCount: 1, uniqueInsiders: 1, uniqueInsidersExcludingMultiOwner: 0, purchaseCountExcludingMultiOwner: 0, multiOwnerPurchaseUsd: 2500, aggregatePurchaseUsdExcludingMultiOwner: null, hasTenPercentOwner: true });
  });

  it("counts ten Sequoia co-filers as one affiliated group", () => {
    const rows = realRows(1792789, "DASH", "0001062993-22-007354");
    expect(rows[0].owners).toHaveLength(10);
    const { clusters } = buildInsiderBuyClusters(rows, { DASH: [] });
    expect(clusters[0].uniqueInsiders).toBe(1);
  });
});
