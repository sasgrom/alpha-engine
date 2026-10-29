import { describe, expect, it } from "vitest";
import { batchSql, csvStats, DOLT_CSV_HEADER, isAllowedOutputRoot, mergeBatches, sha256Text } from "./dolthub-export";

describe("DoltHub export helpers", () => {
  it("builds bounded per-ticker/year queries and rejects invalid identifiers", () => {
    const sql = batchSql("AAPL", 2024);
    expect(sql).toContain("WHERE act_symbol='AAPL'");
    expect(sql).toContain("BETWEEN '2024-01-01' AND '2024-12-31'");
    expect(sql).toContain("ORDER BY date, expiration, strike, call_put");
    expect(() => batchSql("AAPL'; DROP TABLE option_chain; --", 2024)).toThrow();
    expect(() => batchSql("AAPL", 2018)).toThrow();
  });

  it("validates CSV headers and measures empty and populated batches", () => {
    expect(csvStats("")).toEqual({ rows: 0, firstDate: null, lastDate: null });
    expect(csvStats(DOLT_CSV_HEADER)).toEqual({ rows: 0, firstDate: null, lastDate: null });
    const text = `${DOLT_CSV_HEADER}\n2024-01-02,AAPL,2024-01-19,100,call,1,2,0.3,0.5,0.01,-0.02,0.1,0.03\n2024-01-03,AAPL,2024-01-19,100,put,1,2,0.4,-0.5,0.01,-0.02,0.1,0.03\n`;
    expect(csvStats(text)).toEqual({ rows: 2, firstDate: "2024-01-02", lastDate: "2024-01-03" });
    expect(() => csvStats("wrong,header\n1,2")).toThrow();
  });

  it("enforces D:-only output on Windows without restricting other platforms", () => {
    expect(isAllowedOutputRoot("D:\\research\\alpha-engine\\options-iv", "win32")).toBe(true);
    expect(isAllowedOutputRoot("C:\\dev\\alpha-engine", "win32")).toBe(false);
    expect(isAllowedOutputRoot("/tmp/research", "linux")).toBe(true);
  });

  it("preserves old batches during partial resume and replaces only matching keys", () => {
    const previous = [
      { ticker: "AAPL", year: 2023, rows: 10 },
      { ticker: "NVDA", year: 2023, rows: 20 },
    ];
    const current = [{ ticker: "AAPL", year: 2023, rows: 11 }];
    expect(mergeBatches(previous, current)).toEqual([
      { ticker: "AAPL", year: 2023, rows: 11 },
      { ticker: "NVDA", year: 2023, rows: 20 },
    ]);
  });

  it("hashes content deterministically", () => {
    expect(sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
