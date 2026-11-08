import { describe, expect, it } from "vitest";
import { buildInsiderBuyClusters } from "./form4-features";
import { parseForm4Xml } from "./form4-xml";
import { form4FixtureXml } from "./form4-test-fixtures";

const context = {
  accessionNo: "0000000000-26-000001",
  form: "4",
  availableAt: "2026-10-10 16:30:00",
  issuerCik: 50863,
  ticker: "INTC",
  periodOfReport: "2026-10-01",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/50863/000000000026000001/form4.xml",
  inputSha256: "fixture",
};

describe("insider_buy_cluster_v1", () => {
  it("builds a P-only cluster with role flags and no fabricated market inputs", () => {
    const rows = parseForm4Xml(form4FixtureXml(), context);
    const { clusters, exclusionCounts } = buildInsiderBuyClusters(rows, { INTC: [] });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ signal: "insider_buy_cluster_v1", uniqueInsiders: 1, hasCeo: false, hasCfo: true, hasDirector: true, hasTenPercentOwner: false, aggregatePurchaseUsd: 2500, maxSinglePurchaseUsd: 2500, purchaseToMarketCap: { status: "not_computable", value: null }, purchaseToAdv20: { status: "not_computable", value: null }, drawdown20d: { status: "not_computable", value: null }, flipAfterSell90d: false, status: "computed" });
    expect(exclusionCounts).toMatchObject({ award: 1, option_exercise: 1, rsu_tax_withholding: 1, gift: 1, sale: 1 });
  });

  it("marks a cluster partial when purchase value is missing", () => {
    const rows = parseForm4Xml(form4FixtureXml(["P", "P"]), context);
    rows[1].pricePerShare = null;
    rows[1].valueUsd = null;
    const { clusters } = buildInsiderBuyClusters(rows, { INTC: [] });
    expect(clusters[0].status).toBe("partial");
    expect(clusters[0].aggregatePurchaseUsd).toBe(2500);
    expect(clusters[0].missingValueCount).toBe(1);
  });
});
