import { describe, expect, it } from "vitest";
import { classShares, cleanLevel, filedCusip, levelRecord, levelRecordConfirms, mergeFiledParts, movesWith, readCoverPage, readInfoTable, splitStep, valueUnit, type BookPosition, type FiledPart } from "./thirteenf-table";

const row = (fields: { issuer?: string; cusip: string; value: number; amount: number; type?: string; putCall?: string; manager?: number; prefix?: string }) => {
  const p = fields.prefix ?? "";
  return `<${p}infoTable>
   <${p}nameOfIssuer>${fields.issuer ?? "APPLE INC"}</${p}nameOfIssuer>
   <${p}titleOfClass>COM</${p}titleOfClass>
   <${p}cusip>${fields.cusip}</${p}cusip>
   <${p}value>${fields.value}</${p}value>
   <${p}shrsOrPrnAmt>
      <${p}sshPrnamt>${fields.amount}</${p}sshPrnamt>
      <${p}sshPrnamtType>${fields.type ?? "SH"}</${p}sshPrnamtType>
   </${p}shrsOrPrnAmt>
   ${fields.putCall ? `<${p}putCall>${fields.putCall}</${p}putCall>` : ""}
   <${p}investmentDiscretion>DFND</${p}investmentDiscretion>
   <${p}otherManager>${fields.manager ?? 1}</${p}otherManager>
   <${p}votingAuthority><${p}Sole>${fields.amount}</${p}Sole><${p}Shared>0</${p}Shared><${p}None>0</${p}None></${p}votingAuthority>
</${p}infoTable>`;
};
const table = (rows: string[], prefix = "") => `<?xml version="1.0" encoding="UTF-8"?>\n<${prefix}informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">\n${rows.join("\n")}\n</${prefix}informationTable>`;

describe("readInfoTable", () => {
  it("sums the rows of one security instead of keeping the last one", () => {
    const filed = readInfoTable(table([
      row({ cusip: "037833100", value: 1_000_000, amount: 5_000, manager: 1 }),
      row({ cusip: "037833100", value: 3_000_000, amount: 15_000, manager: 2 }),
      row({ cusip: "037833100", value: 200_000, amount: 1_000, manager: 3 }),
      row({ issuer: "MICROSOFT CORP", cusip: "594918104", value: 800_000, amount: 2_000 }),
    ]));
    expect(filed.rows).toBe(4);
    expect(filed.value).toBe(5_000_000);
    expect(filed.securities).toEqual([
      { cusip: "037833100", shares: 21_000, value: 4_200_000, puts: 0, calls: 0, principal: 0 },
      { cusip: "594918104", shares: 2_000, value: 800_000, puts: 0, calls: 0, principal: 0 },
    ]);
  });

  it("keeps options and principal amounts apart from the shares held", () => {
    const filed = readInfoTable(table([
      row({ cusip: "037833100", value: 1_000_000, amount: 5_000 }),
      row({ cusip: "037833100", value: 40_000_000, amount: 200_000, putCall: "Put" }),
      row({ cusip: "037833100", value: 60_000_000, amount: 300_000, putCall: "Call" }),
      row({ issuer: "SOME CORP NOTE 1.5%", cusip: "037833AB6", value: 9_000_000, amount: 9_000_000, type: "PRN" }),
    ]));
    expect(filed.value).toBe(110_000_000);
    expect(filed.securities[0]).toEqual({ cusip: "037833100", shares: 5_000, value: 1_000_000, puts: 40_000_000, calls: 60_000_000, principal: 0 });
    expect(filed.securities[1]).toEqual({ cusip: "037833AB6", shares: 0, value: 0, puts: 0, calls: 0, principal: 9_000_000 });
  });

  it("reads namespace-prefixed tables, lower-case and shortened CUSIPs", () => {
    const filed = readInfoTable(table([row({ cusip: "37833100", value: 10, amount: 1, prefix: "ns1:" }), row({ cusip: "02079k305", value: 20, amount: 2, prefix: "ns1:" })], "ns1:"));
    expect(filed.securities.map((security) => security.cusip)).toEqual(["037833100", "02079K305"]);
    expect(filedCusip(" 594918104 ")).toBe("594918104");
    expect(filedCusip("N/A")).toBeNull();
    expect(readInfoTable("<informationTable></informationTable>")).toEqual({ rows: 0, value: 0, securities: [] });
  });
});

describe("readCoverPage", () => {
  const cover = (inner: string, form = "13F-HR") => `<edgarSubmission><headerData><submissionType>${form}</submissionType><filerInfo><periodOfReport>06-30-2026</periodOfReport></filerInfo></headerData>
    <formData><coverPage><reportCalendarOrQuarter>06-30-2026</reportCalendarOrQuarter>${inner}<filingManager><name>FMR LLC &amp; Co</name></filingManager></coverPage>
    <signatureBlock><signatureDate>08-13-2026</signatureDate></signatureBlock>
    <summaryPage><tableEntryTotal>13978</tableEntryTotal><tableValueTotal>2303900000000</tableValueTotal></summaryPage></formData></edgarSubmission>`;

  it("reads the quarter, the totals and whether the filing replaces or adds", () => {
    expect(readCoverPage(cover("<isAmendment>false</isAmendment>"))).toEqual({
      form: "13F-HR", period: "2026-06-30", amendment: null, amendmentNo: null, manager: "FMR LLC & Co", signed: "2026-08-13", declaredRows: 13978, declaredValue: 2_303_900_000_000,
    });
    const restated = readCoverPage(cover("<isAmendment>true</isAmendment><amendmentNo>2</amendmentNo><amendmentInfo><amendmentType>RESTATEMENT</amendmentType></amendmentInfo>", "13F-HR/A"));
    expect([restated.amendment, restated.amendmentNo]).toEqual(["RESTATEMENT", 2]);
    expect(readCoverPage(cover("<isAmendment>true</isAmendment><amendmentInfo><amendmentType>NEW HOLDINGS</amendmentType></amendmentInfo>", "13F-HR/A")).amendment).toBe("NEW HOLDINGS");
    // an amendment that does not say what it is must not pass for an original
    expect(readCoverPage(cover("", "13F-HR/A")).amendment).toBe("UNKNOWN");
  });
});

describe("valueUnit", () => {
  it("decides dollars or thousands from the prices, whatever the date says", () => {
    expect(valueUnit([0.98, 1.01, 1.0, 1.03])).toEqual({ dollars: 1, shares: 1 });
    expect(valueUnit([0.00099, 0.001, 0.00101])).toEqual({ dollars: 1000, shares: 1 });
    // one odd position does not change the unit of the filing
    expect(valueUnit([1, 1, 1, 1000, 0.02])).toEqual({ dollars: 1, shares: 1 });
    expect(valueUnit([1000, 990, 1012])).toEqual({ dollars: 1, shares: 1000 });
    expect(valueUnit([0.03, 0.04, 0.05])).toBeNull();
    expect(valueUnit([])).toBeNull();
  });
});

describe("mergeFiledParts", () => {
  const position = (shares: number, value: number): BookPosition => ({ shares, value, puts: 0, calls: 0, principal: 0 });
  const part = (accession: string, amendment: FiledPart["amendment"], rows: Record<string, BookPosition>, amendmentNo: number | null = null, signed = "2026-08-14"): FiledPart => ({ accession, amendment, amendmentNo, signed, positions: new Map(Object.entries(rows)) });

  it("lets a restatement replace the book and new holdings add to it", () => {
    const original = part("A1", null, { AAA: position(100, 1_000), BBB: position(50, 500) });
    const added = part("A2", "NEW HOLDINGS", { BBB: position(10, 100), CCC: position(5, 50) }, 1);
    const merged = mergeFiledParts([added, original]);
    expect(merged.used).toEqual(["A1", "A2"]);
    expect(Object.fromEntries(merged.book)).toEqual({ AAA: position(100, 1_000), BBB: position(60, 600), CCC: position(5, 50) });

    const restated = part("A3", "RESTATEMENT", { AAA: position(90, 900) }, 2);
    const final = mergeFiledParts([restated, added, original]);
    expect(final.used).toEqual(["A3"]);
    expect(Object.fromEntries(final.book)).toEqual({ AAA: position(90, 900) });
    // the parts are not changed by merging
    expect(original.positions.get("BBB")).toEqual(position(50, 500));
  });

  it("orders amendments by their number, then by signature date", () => {
    const original = part("B1", null, { AAA: position(100, 1_000) });
    const second = part("B0", "RESTATEMENT", { AAA: position(70, 700) }, 2, "2026-11-05");
    const first = part("B9", "RESTATEMENT", { AAA: position(80, 800) }, 1, "2026-09-01");
    expect(mergeFiledParts([second, first, original]).book.get("AAA")).toEqual(position(70, 700));
  });

  it("goes by what an amendment contains, not by what it calls itself", () => {
    const original = part("C1", null, { AAA: position(1, 1), BBB: position(1, 1), CCC: position(1, 1), DDD: position(1, 1), EEE: position(1, 1) });
    // the whole report again with one row more, filed as "new holdings": adding it would double the book
    const again = part("C2", "NEW HOLDINGS", { AAA: position(1, 1), BBB: position(1, 1), CCC: position(1, 1), DDD: position(1, 1), EEE: position(1, 1), FFF: position(3, 3) }, 1);
    const merged = mergeFiledParts([original, again]);
    expect(merged.used).toEqual(["C2"]);
    expect(merged.book.get("AAA")).toEqual(position(1, 1));
    expect(merged.book.size).toBe(6);
    // an amendment that does not say what it is: most of the book repeated replaces, other securities add
    const full = part("C3", "UNKNOWN", { AAA: position(2, 2), BBB: position(2, 2), CCC: position(2, 2), DDD: position(2, 2) }, 1);
    expect(mergeFiledParts([original, full]).book.size).toBe(4);
    const small = part("C4", "UNKNOWN", { FFF: position(3, 3) }, 1);
    expect(mergeFiledParts([original, small]).book.size).toBe(6);
    // a larger set of holdings first filed confidentially is still an addition
    const disclosed = part("C5", "NEW HOLDINGS", { GGG: position(1, 1), HHH: position(1, 1), III: position(1, 1), JJJ: position(1, 1), KKK: position(1, 1), LLL: position(1, 1) }, 1);
    expect(mergeFiledParts([original, disclosed]).book.size).toBe(11);
    // nothing to amend: the amendment is the book (a report made public a year later)
    expect(mergeFiledParts([disclosed]).book.size).toBe(6);
  });
});

describe("which securities are the company's stock", () => {
  it("accepts a price that moves with the adjusted close, through a split and a dividend", () => {
    // Alphabet over its 20-for-1 split (filed prices against the adjusted close)
    expect(movesWith(2179.26, 95.65, 108.96, 95.65)).toBe(true);
    // a dividend payer: the adjusted close gains a little more than the price
    expect(movesWith(20.0, 21.0, 18.0, 19.2)).toBe(true);
    // another company's stock, a preferred share
    expect(movesWith(16.0, 17.6, 20.0, 19.0)).toBe(false);
    expect(movesWith(25.0, 25.1, 150.0, 172.0)).toBe(false);
    expect(movesWith(0, 10, 10, 10)).toBe(false);
  });

  it("reads a filed price over the split-adjusted close as the split factor since", () => {
    expect(cleanLevel(1.0004)).toBe(1);
    expect(cleanLevel(4.0)).toBe(4);
    expect(cleanLevel(16.002)).toBe(16);
    expect(cleanLevel(39.9)).toBe(40);
    expect(cleanLevel(2.2501)).toBe(2.25);
    expect(cleanLevel(0.1251)).toBe(0.125);
    // an exchange-traded fund, a blank-cheque company at $10 and another company's stock are none of these
    expect(cleanLevel(0.4032)).toBeNull();
    expect(cleanLevel(0.2819)).toBeNull();
    expect(cleanLevel(1.03)).toBeNull();
    expect(splitStep(1.001)).toBe(1);
    expect(splitStep(4.004)).toBe(4);
    expect(splitStep(0.125)).toBe(0.125);
    expect(splitStep(1.0753)).toBeNull();
  });

  const times = (stock: (number | null)[], levels: (number | null)[]) => stock.map((close, index) => (close === null || levels[index] === null ? null : close * levels[index]!));

  it("follows a security back through its splits and returns the share basis per quarter (Arista's old CUSIP)", () => {
    // 16 before the 4-for-1 of November 2021, 4 until the security was replaced before the next 4-for-1
    const stock = [12.6, 12.9, 18.2, 21.5, 35.9, 34.7, 95.9, 110.5, 145.7];
    const record = levelRecord(times(stock, [null, 16.0, 16.0, 16.001, 4.0, 4.0, 3.9999, null, null]), stock)!;
    expect([record.anchor, record.anchorExact]).toEqual([6, true]);
    expect([record.periods, record.pairs, record.exact, record.near]).toEqual([6, 5, 5, 5]);
    expect(record.factors).toEqual([16, 16, 16, 16, 4, 4, 4, 4, 4]);
    expect(record.splits).toEqual([[4, 4]]);
    expect(levelRecordConfirms(record)).toBe(true);
    // the current security of a company: 1 throughout
    expect(levelRecord(times(stock, [1, 1.0002, 0.9999, 1, 1, 1, 1, 1, 1]), stock)!.factors).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("does not take a spin-off adjustment in the price history for a split", () => {
    // the history before a spin-off is scaled by the vendor: the ratio steps by an odd number once
    const stock = [100, 110, 120, 125, 130];
    const record = levelRecord(times(stock, [1.27, 1.27, 1.0, 1.0, 1.0]), stock)!;
    expect([record.pairs, record.exact, record.near]).toEqual([4, 3, 3]);
    expect(record.factors).toEqual([1, 1, 1, 1, 1]);
    expect(record.splits).toEqual([]);
  });

  it("recognises a history lowered by special dividends: the prices keep their distance, not their ratio (CME)", () => {
    const stock = [146.01, 163.25, 185.43, 193.88, 174.58, 212.91, 232.23, 265.29];
    const filed = [167.31, 182.05, 204.23, 212.68, 193.38, 228.46, 232.23, 265.29];
    const record = levelRecord(filed, stock)!;
    // three payments fall between quarter ends ($2.50, $3.25 and $15.55 a share); the other four pairs fit exactly
    expect([record.pairs, record.exact, record.near]).toEqual([7, 4, 7]);
    expect(record.factors).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    // a short record with payments in it does not name the company without the map
    expect(levelRecordConfirms(record)).toBe(false);
    expect(levelRecordConfirms({ ...record, pairs: 26, exact: 17, near: 26, periods: 27 })).toBe(true);
    expect(levelRecordConfirms({ ...record, pairs: 26, exact: 12, near: 26, periods: 27 })).toBe(false);
    expect(levelRecordConfirms({ ...record, anchorExact: false, pairs: 11, exact: 11, near: 11, periods: 12 })).toBe(false);
  });

  it("separates a split from a payment when a company has both (W. R. Berkley)", () => {
    const stock = [33.1178, 40.8933, 50.3867, 54.73, 70.53];
    const basis = [2.25, 1.5, 1.5, 1, 1];
    const paid = [3.5, 3.5, 2.0, 2.0, 0];
    const record = levelRecord(stock.map((close, index) => basis[index] * (close + paid[index])), stock)!;
    expect(record.factors).toEqual(basis);
    expect(record.splits).toEqual([[1, 1.5], [3, 1.5]]);
    expect([record.pairs, record.exact, record.near]).toEqual([4, 2, 4]);
  });

  it("ends the record at a gap instead of reading a split into it (a ticker reused from another company)", () => {
    // before the gap the price series under the ticker is another company's penny stock
    const stock = [0.8426, 0.6901, 0.5442, null, null, 21.43, 17.16, 18.55];
    const filed = [25.49, 20.0, 20.84, 27.22, 25.3, 21.43, 17.16, 18.55];
    const record = levelRecord(filed, stock)!;
    expect([record.periods, record.pairs, record.exact]).toEqual([3, 2, 2]);
    expect(record.factors).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(record.splits).toEqual([]);
  });

  it("rejects a security whose latest price is no split factor of the close", () => {
    expect(levelRecord([10.25, 7.837, 3.549, 1.948, 0.789], [20.716, 29.411, 27.286, 15.159, 12.139])).toBeNull();
    expect(levelRecord([null, null], [10, 11])).toBeNull();
    // a little above the close: cash paid out since the quarter end; allowed, but flagged
    expect(levelRecord([100, 107.5], [100, 100])!.anchorExact).toBe(false);
  });

  it("finds a second share class by its steady price ratio to the main one", () => {
    // one Berkshire A share is 1,500 B shares
    const berkshire = [1497.3, 1502.8, 1500.0, 1509.8, 1506.2, 1507.2, 1498.7, 1497.9, 1522.2, 1517.4, 1507.9, 1518.5, 1501.7, 1500.2];
    expect(classShares(berkshire)).toBe(1500);
    // classes that differ only in votes count share for share
    expect(classShares([1.004, 1.006, 1.011, 1.002, 0.998, 1.008, 1.012, 1.005, 1.003, 1.009, 1.001, 1.007])).toBe(1);
    expect(classShares([0.93, 0.92, 0.94, 0.95, 0.93, 0.91, 0.92, 0.94, 0.96, 0.93, 0.92, 0.94])).toBe(1);
    // too short a record, and a fund whose price ratio to the stock wanders
    expect(classShares(berkshire.slice(0, 8))).toBeNull();
    expect(classShares([0.403, 0.428, 0.419, 0.422, 0.38, 0.385, 0.393, 0.393, 0.386, 0.398, 0.426, 0.489, 0.503])).toBeNull();
  });
});
