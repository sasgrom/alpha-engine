import { describe, expect, it } from "vitest";
import { findSuccessors, nearestSplitProduct, positionBasis, standardPriceHistory, type CompanyHistory, type SecurityHistory } from "./fund-books-matching";

const ids = (count: number, start = 1) => new Set(Array.from({ length: count }, (_, index) => start + index));
const periods = ["2025-12-31", "2026-03-31"];

function company(cusip: string, company: number, before: Set<number>, after: Set<number>, close: number, factors = [1, 1]): CompanyHistory {
  return { cusip, company, holders: [before, after], prices: [close, close], factors };
}

function security(cusip: string, holders: Set<number>, price: number): SecurityHistory {
  return { cusip, holders: [new Set(), holders], prices: [null, price] };
}

describe("successor CUSIPs", () => {
  it("matches a consolidation with a new CUSIP under the same issuer prefix", () => {
    const amcor = company("G0250X107", 1748790, ids(6), ids(2, 9), 43.35);
    const result = findSuccessors([security("G0250X149", new Set([...ids(6), 9, 10]), 43.35)], [amcor]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ cusip: "G0250X149", predecessor: "G0250X107", company: 1748790, t0: 1, overlap: 0.75, predecessorOverlap: 1, priceRatio: 1, factors: [1, 1] });
    expect(result.ambiguous).toEqual([]);
  });

  it("matches a new issuer prefix with holder overlap and the company's own price basis", () => {
    const carnival = company("143658300", 815097, ids(7), ids(3, 8), 23.5);
    const result = findSuccessors([security("G2004J103", new Set([...ids(7), 18]), 23.5)], [carnival]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ cusip: "G2004J103", predecessor: "143658300", company: 815097, t0: 1, overlap: 0.875, predecessorOverlap: 1, priceRatio: 1 });
  });

  it("rejects a new security with the same funds whose price does not fit", () => {
    const amcor = company("G0250X107", 1748790, ids(8), ids(2, 9), 43.35);
    const result = findSuccessors([security("G99999999", ids(8), 86.7)], [amcor]);
    expect(result.matches).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it("lists an ambiguous successor instead of choosing a company", () => {
    const amcor = company("G0250X107", 1748790, ids(8), ids(2, 9), 43.35);
    const decoy = company("G99999990", 999999, ids(8), ids(2, 9), 43.35);
    const result = findSuccessors([security("G0250X149", ids(8), 43.35)], [amcor, decoy]);
    expect(result.matches).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].candidates).toHaveLength(2);
  });

  it("uses the evidenced transition when a few funds adopted the new CUSIP early", () => {
    const predecessor = { cusip: "143658300", company: 815097, holders: [ids(10), ids(10), new Set([11])], prices: [23.5, 25.88, 28.57], factors: [1, 1, 1] };
    const successor = { cusip: "G2004J103", holders: [new Set<number>(), ids(3), ids(10)], prices: [null, 25.88, 28.57] };
    const result = findSuccessors([successor], [predecessor]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ firstQualifiedQuarter: 1, t0: 2, overlap: 1, predecessorOverlap: 1, priceRatio: 1 });
  });

  it("rejects incidental holders of an unrelated security at the same price", () => {
    const predecessor = { cusip: "143658300", company: 815097, holders: [ids(100), new Set([101])], prices: [25.88, 28.57], factors: [1, 1] };
    const result = findSuccessors([security("23306X795", ids(3), 28.57)], [predecessor]);
    expect(result).toEqual({ matches: [], ambiguous: [] });
  });

  it("requires most of the predecessor's holders, not a coincident price and partial overlap", () => {
    const amcor = company("G0250X107", 1748790, ids(165), ids(7, 201), 43.35);
    const qiagen = security("N72482156", new Set([...ids(101), ...ids(31, 201)]), 43.78);
    const result = findSuccessors([qiagen], [amcor]);
    expect(result).toEqual({ matches: [], ambiguous: [] });
  });
});

describe("company-specific split factors", () => {
  it("chooses only a candidate from the company's own history", () => {
    expect(nearestSplitProduct(1.65, [1])).toBeNull();
    expect(nearestSplitProduct(1.65, [1, 1.5, 4])?.ratio).toBe(1.5);
    expect(positionBasis(100, 900, 100, 1, 10, [1, 10])).toMatchObject({ factor: 1, ratio: 0.9, matched: true });
    expect(positionBasis(100, 10000, 100, 1, 10, [1, 10])).toMatchObject({ factor: 10, ratio: 10, matched: true });
  });

  it("keeps the period factor and flags a price that fits no candidate", () => {
    expect(positionBasis(100, 16500, 100, 1, 1, [1])).toMatchObject({ factor: 1, ratio: 1.65, matched: false });
    expect(positionBasis(100, 16500, 100, 1, 10, [1])).toMatchObject({ factor: 10, ratio: 16.5, matched: false });
  });

  it("keeps raw and cross-filing-normalized valuations on their own share bases", () => {
    expect(positionBasis(155024, 29576255, 763.14, 1, 4, [1, 4]).factor).toBe(1);
    expect(positionBasis(155024 / 4, 29576255, 763.14, 1, 4, [1, 4]).factor).toBe(4);
  });

  it("uses the standard split index before and after a consolidation", () => {
    const csv = [
      "date,open,high,low,close,volume,source,dividend,split,distribution,splitIndex,trIndex",
      "2025-12-31,8.38,8.395,8.33,8.34,8688215,schwab,,,,1.0,1.00938524",
      "2026-03-31,38.64,39.775,38.135,39.75,7471106,schwab,,,,0.2,0.9749945",
      "2026-06-30,43.12,43.82,42.75,43.35,3907081,schwab,,,,0.2,1.08090461",
    ].join("\n");
    const history = standardPriceHistory(csv, periods)!;
    expect(history.map(row => row.periodFactor)).toEqual([0.2, 1]);
    expect(history.map(row => row.close)).toEqual([8.34, 39.75]);
    expect(history.map(row => row.candidates)).toEqual([[0.2, 1], [1]]);
    expect(positionBasis(110626, 4795637, 43.35, 1, history[1].periodFactor, history[1].candidates).factor).toBe(1);
  });
});
