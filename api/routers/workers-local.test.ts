/** Unit tests for the workers-local pure parsers (4p). */
import { describe, expect, it } from "vitest";
import { parseIngestReport, parseSchtasksCsv } from "./workers-local";

describe("parseIngestReport", () => {
  it("parses the final report line", () => {
    expect(parseIngestReport("[stocktwits] ingested: 10 new, 0 dupes (1 batch(es))")).toEqual({ accepted: 10, dupes: 0 });
    expect(parseIngestReport("[gdelt-backfill] DONE: 5 accepted, 3 dupes, 0 failed\n[gdelt] ingested: 2 new, 7 dupes")).toEqual({ accepted: 2, dupes: 7 });
  });
  it("returns null on unrelated output", () => {
    expect(parseIngestReport("[gdelt] AAPL: +2 rows")).toBeNull();
    expect(parseIngestReport("")).toBeNull();
  });
});

describe("parseSchtasksCsv", () => {
  const csv = `"HostName","TaskName","Next Run Time","Last Run Time","Last Result"\r\n"MBP","\\AlphaEngine-Stocktwits","10/22/2026 8:30:00 PM","10/22/2026 7:30:02 PM","0"\r\n`;
  it("parses task rows", () => {
    const rows = parseSchtasksCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ taskName: "AlphaEngine-Stocktwits", nextRun: "10/22/2026 8:30:00 PM", lastRun: "10/22/2026 7:30:02 PM", lastResult: "0" });
  });
  it("tolerates empty input", () => {
    expect(parseSchtasksCsv("")).toEqual([]);
    expect(parseSchtasksCsv("header only\n")).toEqual([]);
  });
});
