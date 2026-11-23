import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DESK_COMPANY_SCHEMA_VERSION, type DeskCompanyFilings } from "@contracts/desk-company";
import { buildDeskCompanyFilings, htmlToParagraphs, type CalendarFilingRow } from "../../worker/lib/desk-company";
import { readDeskDocumentText } from "./desk-documents";

const row = (over: Partial<CalendarFilingRow>): CalendarFilingRow => ({
  cik: 9, accessionNo: "0000000009-26-000010", form: "8-K", filingDate: "2026-10-29", reportDate: "2026-10-29", acceptedEt: "2026-10-29T16:05:00", items: "2.02,9.01",
  isEarningsRelease: true, primaryDoc: "form8k.htm", cachedFiles: [{ name: "000000000926000010.htm", bytes: 9000 }, { name: "000000000926000010.ex-slides.htm", bytes: 4000 }, { name: "000000000926000010.ex-ex991.htm", bytes: 90000 }], ...over,
});

describe("desk company filings", () => {
  it("lists the reports newest first, with the items of an 8-K and the cached exhibits of an earnings release, largest first", () => {
    const out = buildDeskCompanyFilings({
      cik: 9, ticker: "FILE", asOf: "2026-11-05", builtAt: "",
      rows: [
        row({ accessionNo: "0000000009-26-000005", form: "10-Q", filingDate: "2026-07-30", reportDate: "2026-06-30", acceptedEt: null, items: null, isEarningsRelease: false, primaryDoc: "q2.htm", cachedFiles: [{ name: "000000000926000005.htm", bytes: 1 }] }),
        row({}),
        row({}),
        row({ accessionNo: "0000000009-19-000001", filingDate: "2019-01-30" }),
      ],
    })!;
    expect(out.asOf).toBe("2026-11-05");
    // a filing listed twice in the calendar files is one filing; one older than five years is left out
    expect(out.filings.map((filing) => [filing.accession, filing.form, filing.filed])).toEqual([["0000000009-26-000010", "8-K", "2026-10-29"], ["0000000009-26-000005", "10-Q", "2026-07-30"]]);
    expect(out.filings[0]).toMatchObject({ items: ["2.02", "9.01"], earnings: true, exhibits: ["000000000926000010.ex-ex991.htm", "000000000926000010.ex-slides.htm"], primaryDoc: "form8k.htm" });
    expect(out.filings[1]).toMatchObject({ items: [], earnings: false, exhibits: [], period: "2026-06-30" });
    expect(buildDeskCompanyFilings({ cik: 9, ticker: "FILE", asOf: "2026-11-05", builtAt: "", rows: [] })).toBeNull();
  });

  it("never lists a cached name that is not an exhibit of that filing", () => {
    const out = buildDeskCompanyFilings({
      cik: 9, ticker: "FILE", asOf: "2026-11-05", builtAt: "",
      rows: [row({ cachedFiles: [{ name: "../../../.env", bytes: 5 }, { name: "000000000926000099.ex-other.htm", bytes: 5 }, { name: "000000000926000010.ex.htm", bytes: 5 }] })],
    })!;
    expect(out.filings[0].exhibits).toEqual(["000000000926000010.ex.htm"]);
  });
});

describe("a release exhibit as text", () => {
  it("keeps the words and drops the markup, one paragraph per block and per table row", () => {
    const html = `<html><head><title>x</title><style>p{color:red}</style></head><body>
      <ix:header><ix:hidden>secret tags</ix:hidden></ix:header>
      <p>Revenue of <b>$94.0&nbsp;billion</b>, up 6&#160;percent year over year</p><script>alert(1)</script>
      <div>Earnings per diluted share of $1.85 &mdash; a September quarter record</div>
      <table><tr><td>Net sales</td><td>$</td><td>94,036</td><td>(</td><td>1,200</td><td>)</td></tr><tr><th>Gross margin</th><td>46.2</td><td>%</td></tr></table>
      <!-- a comment --></body></html>`;
    expect(htmlToParagraphs(html)).toEqual({
      truncated: false,
      paragraphs: [
        "Revenue of $94.0 billion, up 6 percent year over year",
        "Earnings per diluted share of $1.85 — a September quarter record",
        "Net sales | $94,036 | (1,200)",
        "Gross margin | 46.2%",
      ],
    });
    expect(htmlToParagraphs("<p>one</p><p>two</p><p>three</p>", 2)).toEqual({ paragraphs: ["one", "two"], truncated: true });
    // the submission file's own header lines before the document are not part of the release
    expect(htmlToParagraphs(["<DOCUMENT>", "<TYPE>EX-99.1", "<SEQUENCE>2", "<FILENAME>ex991.htm", "<TEXT>", "<html><body><p>Record quarter</p></body></html>"].join(String.fromCharCode(10))).paragraphs).toEqual(["Record quarter"]);
  });
});

describe("reading a cached release for the page", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "desk-documents-"));
  const files = path.join(root, "files"), cache = path.join(root, "cache");
  mkdirSync(path.join(files, "filings"), { recursive: true });
  mkdirSync(path.join(cache, "9"), { recursive: true });
  const filings: DeskCompanyFilings = {
    schemaVersion: DESK_COMPANY_SCHEMA_VERSION, cik: 9, ticker: "FILE", asOf: "2026-11-05", builtAt: "",
    filings: [{ accession: "0000000009-26-000010", form: "8-K", filed: "2026-10-29", acceptedEt: null, period: null, items: ["2.02"], earnings: true, primaryDoc: "form8k.htm", exhibits: ["000000000926000010.ex-ex991.htm", "000000000926000010.ex-gone.htm"] }],
  };
  writeFileSync(path.join(files, "filings", "9.json"), JSON.stringify(filings));
  writeFileSync(path.join(cache, "9", "000000000926000010.ex-ex991.htm"), "<p>Record quarter</p><p>Outlook unchanged</p>");
  writeFileSync(path.join(cache, "9", "000000000926000010.ex-unlisted.htm"), "<p>not listed</p>");
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const read = (accession: string, file: string, cik = 9) => readDeskDocumentText({ cik, accession, file }, { files, cache });

  it("returns the text of an exhibit the company's filings list names", () => {
    expect(read("0000000009-26-000010", "000000000926000010.ex-ex991.htm")).toEqual({ accession: "0000000009-26-000010", file: "000000000926000010.ex-ex991.htm", paragraphs: ["Record quarter", "Outlook unchanged"], truncated: false });
  });

  it("opens nothing else: an unlisted file, another filing, another company, a path, or a file that is not there", () => {
    expect(read("0000000009-26-000010", "000000000926000010.ex-unlisted.htm")).toBeNull();
    expect(read("0000000009-26-000011", "000000000926000010.ex-ex991.htm")).toBeNull();
    expect(read("0000000009-26-000010", "000000000926000010.ex-ex991.htm", 10)).toBeNull();
    expect(read("0000000009-26-000010", "../files/filings/9.json")).toBeNull();
    expect(read("0000000009-26-000010", "000000000926000010.ex-gone.htm")).toBeNull();
  });
});
