import { describe, expect, it } from "vitest";
import { classifyCompanySeries, companyNameKeys, marketWideSeries, namesIn } from "./prediction-market-mapping";
import { KALSHI_COMPANY_SETTLED } from "../../src/test-fixtures/prediction-markets/responses";

const registry = {
  BBY: { cik: 764478, name: "Best Buy Co., Inc." },
  NDAQ: { cik: 1120193, name: "Nasdaq, Inc." },
  SPGI: { cik: 64040, name: "S&P Global Inc." },
  DG: { cik: 29534, name: "Dollar General Corporation" },
  DLTR: { cik: 935703, name: "Dollar Tree, Inc." },
  GIS: { cik: 40704, name: "General Mills, Inc." },
};

describe("company mapping rules", () => {
  it("does not map market-wide series to Nasdaq or S&P Global", () => {
    expect(marketWideSeries("KXNASDAQ100", "Nasdaq-100 range")).toBe(true);
    expect(marketWideSeries("KXINXMAXMM", "S&P 500 monthly maximum")).toBe(true);
    const keys = companyNameKeys(registry);
    expect(classifyCompanySeries({ ticker: "KXNASDAQ100", title: "Nasdaq-100 range", category: "Companies" }, [KALSHI_COMPANY_SETTLED], registry, keys)).toEqual({});
    expect(classifyCompanySeries({ ticker: "KXINXMAXMM", title: "S&P 500 monthly maximum", category: "Financials" }, [KALSHI_COMPANY_SETTLED], registry, keys)).toEqual({});
  });

  it("rejects a daily range series with more than 2,000 numeric markets", () => {
    const markets = Array.from({ length: 2001 }, (_, index) => ({ ...KALSHI_COMPANY_SETTLED, ticker: `KXBBY-26AUGDOMCOMP-${index}` }));
    const result = classifyCompanySeries({ ticker: "KXBBY", title: "Best Buy daily range", category: "Companies" }, markets, registry, companyNameKeys(registry));
    expect(result.entry).toBeUndefined();
    expect(result.rejected).toMatchObject({ series: "KXBBY", markets: 2001, reason: "too many markets: a daily range series" });
  });

  it("preserves an unambiguous company mapping", () => {
    const result = classifyCompanySeries({ ticker: "KXBBY", title: "Best Buy Co., Inc. comparable store sales", category: "Companies" }, [KALSHI_COMPANY_SETTLED], registry, companyNameKeys(registry));
    expect(result.entry).toMatchObject({ series: "KXBBY", ticker: "BBY", cik: 764478, kind: "business", settled: 1 });
  });

  it("rejects conflicting company names instead of guessing", () => {
    const market = { ...KALSHI_COMPANY_SETTLED, title: "Will Dollar General Corporation report sales above 8%?" };
    const result = classifyCompanySeries({ ticker: "KXDLTRFT", title: "Dollar Tree Foot Traffic", category: "Companies" }, [market], registry, companyNameKeys(registry));
    expect(result.entry).toBeUndefined();
    expect(result.rejected?.named).toEqual(["DG", "DLTR"]);
  });

  it("requires both words in a two-word key and excludes generic single-word names", () => {
    const keys = companyNameKeys(registry);
    expect(keys.get("GENERAL")).toBeUndefined();
    expect(namesIn("General Mills sales", keys)).toEqual(new Set(["GIS"]));
    expect(namesIn("Best Buy Co., Inc. sales", keys)).toEqual(new Set(["BBY"]));
    expect(namesIn("Best Co., Inc. sales", keys)).toEqual(new Set());
  });
});
