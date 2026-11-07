import { describe, expect, it } from "vitest";
import { buildPilotEvidence, type EvidenceCompanyFacts } from "./pilot-exposure-evidence";

const record = (end: string, val: number, filed = end, start?: string) => ({ end, val, filed, form: "10-K", accn: "0001-26-000001", ...(start ? { start } : {}) });
type Fact = ReturnType<typeof record>;
const facts = (concepts: Record<string, Record<string, Fact[]>>): EvidenceCompanyFacts => ({
  cik: 1,
  facts: { "us-gaap": Object.fromEntries(Object.entries(concepts).map(([concept, units]) => [concept, { units }])) },
});

describe("pilot exposure evidence", () => {
  it("uses exact current rate concepts and preserves their availability", () => {
    const company = buildPilotEvidence(facts({
      LongTermDebtPercentageBearingFixedInterestRate: { pure: [record("2026-09-30", 0.97, "2026-10-30")] },
      DebtWeightedAverageInterestRate: { pure: [record("2026-09-30", 0.0471, "2026-10-30")] },
      LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo: { USD: [record("2026-09-30", 3211000000, "2026-10-30")] },
    }), "RCL", "2026-11-02T00:00:00Z");
    expect(company.fixedInterestShare?.value).toBe(0.97);
    expect(company.weightedAverageInterestRate?.value).toBe(0.0471);
    expect(company.debtMaturities[0].value).toBe(3211000000);
    expect(company.debtMaturities[0].sourceUrl).toContain("000126000001");
  });

  it("preserves the start of a YTD exposure period", () => {
    const company = buildPilotEvidence(facts({
      FuelCosts: { USD: [record("2026-09-30", 11202000000, "2026-10-09", "2026-01-01")] },
    }), "DAL", "2026-11-02T00:00:00Z");
    expect(company.fuelCost?.periodStart).toBe("2026-01-01");
    expect(company.fuelCost?.periodEnd).toBe("2026-09-30");
  });

  it("computes foreign revenue share only from matching periods and marks it stale", () => {
    const company = buildPilotEvidence(facts({
      RevenueFromContractWithCustomerExcludingAssessedTax: { USD: [record("2011-04-03", 100, "2011-05-01")] },
      EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToEntitysCountryOfDomicile: { USD: [record("2011-04-03", 40, "2011-05-01")] },
      NotionalAmountOfForeignCurrencyDerivatives: { USD: [record("2011-04-03", 5, "2011-05-01")] },
    }), "PFE", "2026-11-02T00:00:00Z");
    expect(company.foreignRevenueShare?.value).toBeCloseTo(0.6);
    expect(company.foreignRevenueShare?.unit).toBe("ratio");
    expect(company.foreignRevenueShare?.stale).toBe(true);
    expect(company.foreignDerivativeNotional?.value).toBe(5);
  });

  it("marks old economic periods stale even when the accession is recent", () => {
    const company = buildPilotEvidence(facts({
      PercentageOfDebtHedgedByInterestRateDerivatives: { pure: [record("2023-12-31", 0.6, "2026-10-30")] },
    }), "COP", "2026-11-02T00:00:00Z");
    expect(company.interestRateHedgeShare?.stale).toBe(true);
  });

  it("uses direct foreign-country revenue and rejects cross-accession ratios", () => {
    const direct = buildPilotEvidence(facts({
      Revenues: { USD: [record("2025-12-31", 200, "2026-02-01", "2025-01-01")] },
      EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToForeignCountries: { USD: [record("2025-12-31", 80, "2026-02-01", "2025-01-01")] },
    }), "PFE", "2026-11-02T00:00:00Z");
    expect(direct.foreignRevenueShare?.value).toBeCloseTo(0.4);
    expect(direct.foreignRevenueShare?.concepts).toEqual([
      "EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToForeignCountries",
      "Revenues",
    ]);

    const mismatched = buildPilotEvidence(facts({
      Revenues: { USD: [{ ...record("2025-12-31", 200, "2026-02-01", "2025-01-01"), accn: "0001-26-000001" }] },
      EntityWideDisclosureOnGeographicAreasRevenueFromExternalCustomersAttributedToForeignCountries: { USD: [{ ...record("2025-12-31", 80, "2026-02-01", "2025-01-01"), accn: "0001-26-000002" }] },
    }), "PFE", "2026-11-02T00:00:00Z");
    expect(mismatched.foreignRevenueShare).toBeNull();
  });

  it("keeps direct variable-rate evidence and long-term weighted-average aliases", () => {
    const company = buildPilotEvidence(facts({
      LongTermDebtPercentageBearingVariableInterestRate: { pure: [record("2026-09-30", 0.25, "2026-10-30")] },
      LongtermDebtWeightedAverageInterestRate: { pure: [record("2026-09-30", 0.05, "2026-10-30")] },
    }), "RCL", "2026-11-02T00:00:00Z");
    expect(company.variableInterestShare?.value).toBe(0.25);
    expect(company.weightedAverageInterestRate?.concept).toBe("LongtermDebtWeightedAverageInterestRate");
  });

  it("does not invent missing fuel, oil or rate-hedge evidence", () => {
    const company = buildPilotEvidence(facts({}), "CVX", "2026-11-02T00:00:00Z");
    expect(company.fuelCost).toBeNull();
    expect(company.oilRevenue).toBeNull();
    expect(company.interestRateHedgeShare).toBeNull();
    expect(company.missing).toContain("direct fuel or oil exposure");
  });
});
