import { describe, expect, it } from "vitest";
import { assertExactRemediationScope, assertOnlyExpectedTickerFieldsChanged, EXPECTED_TICKER_REMEDIATION } from "./preferred-ticker-remediation";

const rows = () => EXPECTED_TICKER_REMEDIATION.map((row) => ({ cik: row.cik, ticker: row.before, name: `Company ${row.cik}` }));
const mismatches = () => EXPECTED_TICKER_REMEDIATION.map((row) => ({ cik: row.cik, ticker: row.before }));

describe("preferred ticker remediation guards", () => {
  it("accepts exactly the six approved mismatches", () => {
    expect(() => assertExactRemediationScope(mismatches())).not.toThrow();
  });

  it("stops on an additional mismatch instead of expanding scope", () => {
    expect(() => assertExactRemediationScope([...mismatches(), { cik: 320193, ticker: "AAPL-PA" }])).toThrow("scope changed");
  });

  it("stops when an expected mismatch is absent", () => {
    expect(() => assertExactRemediationScope(mismatches().slice(1))).toThrow("scope changed");
  });

  it("proves only the six ticker fields changed", () => {
    const before = [...rows(), { cik: 320193, ticker: "AAPL", name: "Apple" }];
    const after = before.map((row) => {
      const expected = EXPECTED_TICKER_REMEDIATION.find((item) => item.cik === row.cik);
      return expected ? { ...row, ticker: expected.after } : row;
    });
    expect(assertOnlyExpectedTickerFieldsChanged(before, after)).toEqual(EXPECTED_TICKER_REMEDIATION.map((row) => row.cik).sort((a, b) => a - b));
  });

  it("rejects non-ticker edits, other ticker edits and row-count changes", () => {
    const before = rows();
    expect(() => assertOnlyExpectedTickerFieldsChanged(before, before.map((row) => ({ ...row, name: "changed" })))).toThrow("Non-ticker field changed");
    expect(() => assertOnlyExpectedTickerFieldsChanged(before, [...before, { cik: 320193, ticker: "AAPL" }])).toThrow("row count changed");
    expect(() => assertOnlyExpectedTickerFieldsChanged([...before, { cik: 320193, ticker: "AAPL" }], [...before, { cik: 320193, ticker: "AAPL-PA" }])).toThrow("Changed ticker IDs");
  });
});
