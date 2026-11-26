import { describe, expect, it } from "vitest";
import { filerKey, parse13D, stakeOf } from "./schedule-13d";

// shortened from real filings: the structured form SEC renders since December 2024, and an older text cover
const NEW = `<html><body><p>SCHEDULE 13D (Amendment No. 2)</p><p>Henry Schein, Inc.</p><p>(Name of Issuer)</p><p>Common Stock</p>
<p>806407102</p><p>(CUSIP Number)</p><p>SCHEDULE 13D CUSIP No. 806407102</p>
<table><tr><td>1</td><td>Name of reporting person</td><td>KKR Hawaii Aggregator L.P.</td></tr>
<tr><td>2</td><td>Check the appropriate box if a member of a Group (See Instructions)</td></tr>
<tr><td>11</td><td>Aggregate amount beneficially owned by each reporting person</td><td>11,628,344.00</td></tr>
<tr><td>13</td><td>Percent of class represented by amount in Row (11)</td><td>9.4 %</td></tr></table>
<p>SCHEDULE 13D CUSIP No. 806407102</p><table><tr><td>1</td><td>Name of reporting person</td><td>KKR &amp; Co. Inc.</td></tr>
<tr><td>2</td><td>Check the appropriate box if a member of a Group</td></tr><tr><td>11</td><td>Aggregate amount beneficially owned by each reporting person</td><td>11,628,344.00</td></tr>
<tr><td>13</td><td>Percent of class represented by amount in Row (11)</td><td>9.4 %</td></tr></table></body></html>`;
const OLD = `SCHEDULE 13D Mesa Air Group, Inc. (Name of Issuer) Common Stock 590479135 (CUSIP Number) CUSIP No: 590479135 SCHEDULE 13D Page 2 of 8 pages
1 NAMES OF REPORTING PERSONS United Airlines Holdings, Inc. 36-2675207 2 CHECK THE APPROPRIATE BOX IF A MEMBER OF A GROUP (a) (b) 3 SEC USE ONLY
11 AGGREGATE AMOUNT BENEFICIALLY OWNED BY EACH REPORTING PERSON 4,042,061 12 CHECK BOX 13 PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW (11) 9.9999998% (1) 14 TYPE`;

describe("Schedule 13D cover pages", () => {
  it("reads the structured form: CUSIP, issuer, each reporting person's shares and percent", () => {
    const filing = parse13D(NEW);
    expect(filing.cusip).toBe("806407102");
    expect(filing.issuer).toBe("Henry Schein, Inc.");
    expect(filing.covers).toEqual([
      { name: "KKR Hawaii Aggregator L.P.", shares: 11628344, percent: 9.4 },
      { name: "KKR & Co. Inc.", shares: 11628344, percent: 9.4 },
    ]);
    expect(stakeOf(filing)).toEqual({ lead: "KKR Hawaii Aggregator L.P.", shares: 11628344, percent: 9.4 });
  });

  it("reads an older text cover, without the tax number in the name", () => {
    const filing = parse13D(OLD);
    expect(filing.cusip).toBe("590479135");
    expect(filing.issuer).toBe("Mesa Air Group, Inc.");
    expect(filing.covers[0]).toEqual({ name: "United Airlines Holdings, Inc.", shares: 4042061, percent: 9.9999998 });
  });

  it("drops the older forms' row caption, tax numbers and stray marks from a name", () => {
    const covers = (text: string) => parse13D(`CUSIP No. 123456789 ${text}`).covers.map((cover) => cover.name);
    expect(covers("1 NAMES OF REPORTING PERSONS I.R.S. IDENTIFICATION NOS. OF ABOVE PERSONS (ENTITIES ONLY) Trian Fund Management, L.P. 20-3454182 2 CHECK THE APPROPRIATE BOX")).toEqual(["Trian Fund Management, L.P."]);
    expect(covers("1 NAME OF REPORTING PERSON /S.S. OR I.R.S. INDENTIFICATION NO. OF ABOVE PERSON Starboard Value LP 2 CHECK THE APPROPRIATE BOX")).toEqual(["Starboard Value LP"]);
    expect(covers("1 Names of Reporting Persons. Ronda E. Stryker 2.Check the Appropriate Box")).toEqual(["Ronda E. Stryker"]);
    expect(covers("1 NAME OF REPORTING PERSON ; PHILLIPS 66 2 CHECK THE APPROPRIATE BOX")).toEqual(["PHILLIPS 66"]);
    expect(covers("(1) Names of Reporting Persons Nelson Peltz (2) CHECK THE APPROPRIATE BOX IF A MEMBER OF A GROUP")).toEqual(["Nelson Peltz"]);
    expect(covers("1 NAME OF REPORTING PERSON S.S. OR I.R.S. IDENTIFICATION NO. OF ABOVE PERSON Miriam Adelson 2 CHECK THE APPROPRIATE BOX")).toEqual(["Miriam Adelson"]);
    expect(covers("1 Name of reporting person Longview Asset Management, LLC I.R.S. Identification No.: 36- 4245844 2 Check the appropriate box")).toEqual(["Longview Asset Management, LLC"]);
    expect(covers("1 NAME OF REPORTING PERSON Deutsche Telekom AG IRS identification number not applicable. 2 CHECK THE APPROPRIATE BOX")).toEqual(["Deutsche Telekom AG"]);
    expect(covers("1 NAME OF REPORTING PERSON ValueAct Capital Master Fund, L.P. ---------- 2 CHECK THE APPROPRIATE BOX")).toEqual(["ValueAct Capital Master Fund, L.P."]);
  });

  it("keys one filer across its funds and filings", () => {
    expect(filerKey("Starboard Value LP")).toBe(filerKey("Starboard Value L.P."));
    expect(filerKey("Elliott Investment Management L.P.")).toBe("elliott investment");
  });
});
