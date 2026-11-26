import { describe, expect, it } from "vitest";
import { amountRange, parseHousePdfText, parseSenateHtml, parseSenateSearchRows } from "./congress";
import type { HouseFiling } from "./congress-house";

const house: HouseFiling = { docId: "20000077", year: 2014, member: "Robert E. Andrews", firstName: "Robert E.", lastName: "Andrews", state: "NJ", district: "01", filingType: "P", filedDate: "2014-01-13" };

describe("Congress transaction parsers", () => {
  it("parses electronic House PDF text with owner, dates, asset and amount", () => {
    const text = `Filing Id # 20000077\nP t r\ntranSactionS\niD owner asset transaction Date notification amount\ntype Date\nsP Hill International, Inc. (HIl) s 12/26/2013 12/30/2013 $15,001 - $50,000\nDC Example Co (EX) P 1/2/2014 1/3/2014 Over $50,000,000\nFILINg sTATus: New`;
    expect(parseHousePdfText(text, house, "abc")).toEqual([
      expect.objectContaining({ chamber: "house", filer: "spouse", owner: "SP", asset: "Hill International, Inc. (HIl)", ticker: "HIl", assetType: "stock", type: "sale", transactionDate: "2013-12-26", notificationDate: "2013-12-30", amountLow: 15001, amountHigh: 50000, parseMethod: "text PDF" }),
      expect.objectContaining({ filer: "child", type: "purchase", transactionDate: "2014-01-02", amountLow: 50000000, amountHigh: null }),
    ]);
  });

  it("lists a scanned or wrong House PDF rather than inventing transactions", () => {
    expect(parseHousePdfText("Filing ID #20000077\nno transaction rows", house, "abc")).toEqual([]);
    expect(() => parseHousePdfText("Filing ID #1", house, "abc")).toThrow("does not identify");
  });

  it("reassembles wrapped House assets and amount ranges without checkbox artifacts", () => {
    const text = `Filing ID #20000077\n2000041538 SP Phillips 66 (PSX) [ST] S 07/30/2018 08/06/2018 $1,001 - gfedc\n$15,000\n2000041539 SP Royal Dutch Shell PLC Royal S 07/30/2018 08/06/2018 $1,001 - gfedcb\nDutch Shell PLC American $15,000\nDepositary Shares (RDS.B) [ST]`;
    const trades = parseHousePdfText(text, house, "abc");
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ asset: "Phillips 66 (PSX) [ST]", ticker: "PSX", assetType: "stock", amountLow: 1001, amountHigh: 15000, comment: "" });
    expect(trades[1]).toMatchObject({ asset: "Royal Dutch Shell PLC Royal Dutch Shell PLC American Depositary Shares (RDS.B) [ST]", ticker: "RDS.B", amountLow: 1001, amountHigh: 15000, comment: "" });
  });

  it("parses a Senate HTML table including a partial sale", () => {
    const html = `<table><thead><tr><th>Transaction</th><th>Date</th><th>Owner</th><th>Ticker</th><th>Asset Name</th><th>Asset Type</th><th>Type</th><th>Amount</th><th>Comment</th></tr></thead><tbody><tr><td>1</td><td>01/02/2025</td><td>Spouse</td><td>ABC</td><td>ABC Corp</td><td>Stock</td><td>Purchase</td><td>$1,001 - $15,000</td><td>First</td></tr><tr><td>2</td><td>01/03/2025</td><td>--</td><td>--</td><td>Example Bond</td><td>Bond</td><td>Sale (Partial)</td><td>$15,001 - $50,000</td><td></td></tr></tbody></table>`;
    expect(parseSenateHtml(html, { member: "Senator Example", state: "VA", district: null, reportId: "r1", filedDate: "2025-02-01", sourceSha256: "def", sourceUrl: "https://efdsearch.senate.gov/report/r1/" })).toEqual([
      expect.objectContaining({ chamber: "senate", filer: "spouse", transactionDate: "2025-01-02", ticker: "ABC", assetType: "stock", type: "purchase", amountLow: 1001, amountHigh: 15000, comment: "First", parseMethod: "HTML" }),
      expect.objectContaining({ filer: "member", transactionDate: "2025-01-03", ticker: null, assetType: "bond", type: "partial sale" }),
    ]);
  });

  it("uses source codes for bonds and option names for calls", () => {
    const text = `Filing ID #20000077\nJT DISH DBS CoRP NTS B/E 05.875% 071522 [CS] S 05/21/2018 06/01/2018 $15,001 - $50,000\nJT NORTH TX TWY auTH REV RFdG SYS 1ST TIER SER B B/E [GS] S 04/16/2020 04/20/2020 $100,001 - $250,000`;
    expect(parseHousePdfText(text, house, "abc").map(row => row.assetType)).toEqual(["bond", "bond"]);
    const html = `<table><thead><tr><th>Transaction Date</th><th>Owner</th><th>Ticker</th><th>Asset Name</th><th>Asset Type</th><th>Type</th><th>Amount</th><th>Comment</th></tr></thead><tbody><tr><td>01/27/2025</td><td>Self</td><td>--</td><td>NCLH CALL</td><td>Stock</td><td>Sale (Full)</td><td>$1,001 - $15,000</td><td>--</td></tr></tbody></table>`;
    expect(parseSenateHtml(html, { member: "Example", state: null, district: null, reportId: "opt", filedDate: "2025-02-01", sourceSha256: "x", sourceUrl: "https://efdsearch.senate.gov/opt" })[0].assetType).toBe("option");
  });

  it("parses official Senate search links and filing dates", () => {
    expect(parseSenateSearchRows([["Lamar", "Alexander", "Alexander, Lamar (Senator)", '<a href="/search/view/ptr/a5ea65ef-3943-4944-b192-988ab6adaa21/">Periodic Transaction Report</a>', "11/30/2017"]])).toEqual([{ firstName: "Lamar", lastName: "Alexander", member: "Alexander, Lamar", reportId: "a5ea65ef-3943-4944-b192-988ab6adaa21", filedDate: "2017-11-30", sourceUrl: "https://efdsearch.senate.gov/search/view/ptr/a5ea65ef-3943-4944-b192-988ab6adaa21/", sourceKind: "ptr" }]);
  });

  it("handles open-ended and absent amount ranges without guessing", () => {
    expect(amountRange("Over $50,000,000")).toEqual({ low: 50000000, high: null });
    expect(amountRange("None")).toEqual({ low: null, high: null });
  });
});
