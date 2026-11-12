import { describe, expect, it } from "vitest";
import { isNonAdditiveQuarterlyConcept } from "./series";

describe("non-additive quarterly concepts", () => {
  it("blocks average-share and per-share YTD subtraction", () => {
    for (const concept of [
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "WeightedAverageNumberOfSharesOutstandingBasic",
      "WeightedAverageNumberDilutedSharesOutstandingAdjustment",
      "EarningsPerShareDiluted",
      "EarningsPerShareBasic",
      "BookValuePerShare",
    ]) {
      expect(isNonAdditiveQuarterlyConcept(concept), concept).toBe(true);
    }
  });

  it("retains derivation for additive flows", () => {
    for (const concept of [
      "NetIncomeLoss",
      "NetCashProvidedByUsedInOperatingActivities",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Assets",
    ]) {
      expect(isNonAdditiveQuarterlyConcept(concept), concept).toBe(false);
    }
  });
});
