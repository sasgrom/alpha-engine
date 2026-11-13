import { describe, expect, it } from "vitest";
import { latestFieldValues, periodMatches, presentQuarters, scopeCheck } from "./standard-fundamentals-gaps.mts";

function company(fields: Parameters<typeof scopeCheck>[0]["fields"]): Parameters<typeof scopeCheck>[0] {
  return {
    cik: 1, ticker: "TEST", name: "Test",
    quarters: [
      { end: "2020-03-31", start: "2020-01-01" },
      { end: "2020-06-30", start: "2020-04-01" },
      { end: "2020-09-30", start: "2020-07-01" },
    ],
    fields,
  };
}
function candidate(value: number, startDate: string | null, endDate: string, concept = "Candidate"): Parameters<typeof scopeCheck>[2] {
  return { concept, value, startDate, endDate, filed: "2020-11-01", form: "10-Q", accessionNo: "accn", unit: "USD", factId: 1 };
}
const versions = (value: number | null, filed = "2020-11-01"): [string, number | null, number][] => [[filed, value, 0]];

describe("standard fundamentals gap mining", () => {
  it("accepts instant dates within five days and quarterly/YTD flows, not short or long periods", () => {
    expect(periodMatches({ startDate: null, endDate: "2020-04-05" }, "2020-03-31", "instant")).toBe(true);
    expect(periodMatches({ startDate: null, endDate: "2020-04-06" }, "2020-03-31", "instant")).toBe(false);
    expect(periodMatches({ startDate: "2020-01-01", endDate: "2020-03-31" }, "2020-03-31", "flow")).toBe(true);
    expect(periodMatches({ startDate: "2020-01-01", endDate: "2020-09-30" }, "2020-09-30", "flow")).toBe(true);
    expect(periodMatches({ startDate: "2020-01-01", endDate: "2020-02-29" }, "2020-03-31", "flow")).toBe(false);
    expect(periodMatches({ startDate: "2019-08-01", endDate: "2020-09-30" }, "2020-09-30", "flow")).toBe(false);
  });

  it("uses the latest finite version, including a reported zero", () => {
    const values = latestFieldValues(company({ capex: [[0, [...versions(10), ...versions(0, "2021-02-01")]]] }), "capex");
    expect(values.get("2020-03-31")).toEqual({ value: 0, filed: "2021-02-01" });
  });

  it("sums the complete YTD period for a scope check and preserves outflow signs", () => {
    const result = scopeCheck(company({ capex: [[0, versions(-25)], [1, versions(-50)], [2, versions(-75)]] }), "capex", candidate(-150, "2020-01-01", "2020-09-30"));
    expect(result.basisValue).toBe(-150);
    expect(result.ratio).toBe(1);
    expect(result.aggregation).toBe("same_duration_sum");
    expect(result.judgement).toBe("same scope, add to list");
    expect(result.suggestedSign).toBe(1);
  });

  it("uses the related identity when the field itself is missing", () => {
    const result = scopeCheck(company({ revenue: [[2, versions(1000)]], grossProfit: [[2, versions(400)]] }), "costRev", candidate(600, "2020-07-01", "2020-09-30"));
    expect(result.basis).toBe("revenue − grossProfit");
    expect(result.basisValue).toBe(600);
    expect(result.ratio).toBe(1);
    expect(result.judgement).toBe("same scope, add to list");
  });

  it("enforces the smaller-than constraint and records nearest-quarter offsets", () => {
    const input = company({ liabilitiesCurrent: [[0, versions(1000)]] });
    const part = scopeCheck(input, "debtCurrent", candidate(600, null, "2020-04-04"));
    expect(part.judgement).toBe("a part, do not add");
    expect(part.offsetDays).toBe(4);
    expect(part.basisPeriodEnd).toBe("2020-03-31");
    expect(scopeCheck(input, "debtCurrent", candidate(1200, null, "2020-03-31")).judgement).toBe("a different measure");
  });

  it("does not confuse net interest, financial securities or preferred shares with the target field", () => {
    const net = scopeCheck(company({ intexp: [[0, versions(100)]] }), "intexp", candidate(-100, "2020-01-01", "2020-03-31", "InterestIncomeExpenseNet"));
    expect(net.judgement).toBe("a different measure");
    expect(net.constraint).toContain("semantic exclusion");
    const security = scopeCheck(company({ debtNonCurrent: [[0, versions(100)]] }), "debtNonCurrent", candidate(100, null, "2020-03-31", "AvailableForSaleSecuritiesDebtSecurities"));
    expect(security.judgement).toBe("a different measure");
    const preferred = scopeCheck(company({ sharesBasic: [[0, versions(100)]] }), "sharesBasic", candidate(100, null, "2020-03-31", "PreferredStockSharesIssued"));
    expect(preferred.judgement).toBe("a different measure");
  });

  it("counts coverage within the same filtered quarter cohort", () => {
    const input = company({ capex: [[0, versions(-25)], [1, versions(-50)], [2, versions(-75)]] });
    expect(presentQuarters(input, "capex", input.quarters.slice(1))).toBe(2);
    expect(presentQuarters(input, "capex", input.quarters.slice(2))).toBe(1);
    expect(presentQuarters(input, "capex", input.quarters.slice(2))).toBeLessThanOrEqual(1);
  });
});
