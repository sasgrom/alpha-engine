import type { ExpectationStatement } from "./expectations";

export const COMPANY_INDUSTRY: Record<string, string> = {
  NVDA: "semiconductors", AMD: "semiconductors", INTC: "semiconductors", AVGO: "semiconductors", MU: "semiconductors", SMCI: "technology_hardware",
  PLTR: "software", MSFT: "software", IBM: "it_services", META: "interactive_media", GOOGL: "interactive_media", NFLX: "media_entertainment",
  AMZN: "broadline_retail", TSLA: "automobiles", NKE: "apparel", LULU: "apparel", RCL: "cruise_lines",
  GS: "capital_markets", COF: "banks", JPM: "banks", AIG: "insurance", MA: "payment_networks", V: "payment_networks",
  UNH: "managed_care", PFE: "pharmaceuticals", MRNA: "biotechnology", LLY: "pharmaceuticals", JNJ: "healthcare_diversified",
  FCX: "metals_mining", COP: "oil_and_gas", CVX: "oil_and_gas", KMI: "energy_midstream", LIN: "industrial_gases",
  BA: "aerospace_defense", LMT: "aerospace_defense", CAT: "machinery", PLD: "industrial_reit", AMT: "telecom_infrastructure_reit",
  NEE: "utilities", ANET: "networking_hardware", CSCO: "networking_hardware", AAPL: "consumer_electronics", FSLR: "solar_equipment",
  DAL: "airlines", DASH: "internet_delivery", HD: "home_improvement_retail", WMT: "consumer_staples_retail", COST: "consumer_staples_retail",
  T: "telecom_services", PG: "household_products",
};

interface CanonicalMetricAlias {
  ruleId: string;
  pattern: RegExp;
  canonicalMetric: string | ((statement: ExpectationStatement) => string);
  industries?: string[];
  tickers?: string[];
}

const basisSuffix = (statement: ExpectationStatement) => statement.basis === "non_gaap" || statement.basis === "adjusted" ? "non_gaap" : statement.basis === "gaap" ? "gaap" : "reported";

const ALIASES: CanonicalMetricAlias[] = [
  { ruleId: "ALIAS_BANK_NII_EXCLUDING_MARKETS", pattern: /excluding markets/i, canonicalMetric: "nii.excluding_markets", industries: ["banks"] },
  { ruleId: "ALIAS_BANK_NET_CHARGE_OFF", pattern: /net charge[ -]off/i, canonicalMetric: "credit.net_charge_off_rate", industries: ["banks"] },
  { ruleId: "ALIAS_MSFT_INTELLIGENT_CLOUD", pattern: /Intelligent Cloud/i, canonicalMetric: "segment_revenue.intelligent_cloud", tickers: ["MSFT"] },
  { ruleId: "ALIAS_DASH_MARKETPLACE_GOV", pattern: /Marketplace GOV/i, canonicalMetric: "marketplace.gov", tickers: ["DASH"] },
  { ruleId: "ALIAS_RCL_NET_YIELD", pattern: /Net Yields/i, canonicalMetric: "cruise.net_yield", tickers: ["RCL"] },
  { ruleId: "ALIAS_RCL_NET_CRUISE_COST", pattern: /Net Cruise Costs per APCD/i, canonicalMetric: "cruise.net_cost_per_apcd", tickers: ["RCL"] },
  { ruleId: "ALIAS_DAL_PASSENGER_UNIT_REVENUE", pattern: /Passenger unit revenue/i, canonicalMetric: "airline.passenger_unit_revenue", tickers: ["DAL"] },
  { ruleId: "ALIAS_DAL_CARGO_REVENUE", pattern: /Cargo and other revenue/i, canonicalMetric: "revenue.cargo_and_other", tickers: ["DAL"] },
  { ruleId: "ALIAS_DAL_MAINLINE_CAPACITY", pattern: /Mainline capacity/i, canonicalMetric: "airline.mainline_capacity", tickers: ["DAL"] },
  { ruleId: "ALIAS_EPS_DILUTED", pattern: /diluted (?:earnings|earnings per|EPS)|diluted_earnings_per_share|earnings per diluted|(?:GAAP|non-GAAP) EPS|earnings per share/i, canonicalMetric: (statement) => `eps.diluted.${basisSuffix(statement)}` },
  { ruleId: "ALIAS_CORE_FFO_DILUTED", pattern: /Core FFO per diluted share/i, canonicalMetric: "ffo.core.diluted" },
  { ruleId: "ALIAS_OPERATING_EPS", pattern: /Operating EPS/i, canonicalMetric: "eps.operating" },
  { ruleId: "ALIAS_ADJUSTED_EPS", pattern: /Adjusted EPS/i, canonicalMetric: "eps.adjusted" },
  { ruleId: "ALIAS_EPS", pattern: /^EPS\b/i, canonicalMetric: (statement) => `eps.${basisSuffix(statement)}` },
  { ruleId: "ALIAS_DILUTED_SHARES", pattern: /diluted (?:weighted average )?(?:shares outstanding|share count)/i, canonicalMetric: "shares.diluted" },
  { ruleId: "ALIAS_BASIC_SHARES", pattern: /Basic weighted average shares outstanding/i, canonicalMetric: "shares.basic_weighted_average" },
  { ruleId: "ALIAS_TOTAL_EXPENSES", pattern: /^total expenses/i, canonicalMetric: "expense.total" },
  { ruleId: "ALIAS_NON_OPERATING_EXPENSE", pattern: /Non-operating expense/i, canonicalMetric: "expense.non_operating" },
  { ruleId: "ALIAS_INTEREST_EXPENSE", pattern: /interest expense/i, canonicalMetric: "expense.interest" },
  { ruleId: "ALIAS_RD_COMPOUND", pattern: /R&D plus MG&A|Spending \(R&D plus MG&A\)/i, canonicalMetric: "expense.research_and_administration" },
  { ruleId: "ALIAS_RD", pattern: /research and development (?:expenses|spending)|R&D spending/i, canonicalMetric: "expense.research_and_development" },
  { ruleId: "ALIAS_MARKETING_ADMIN", pattern: /marketing and administrative expenses|SG&A expenses/i, canonicalMetric: "expense.marketing_and_administration" },
  { ruleId: "ALIAS_STOCK_COMPENSATION", pattern: /Stock-based compensation expense/i, canonicalMetric: "expense.stock_based_compensation" },
  { ruleId: "ALIAS_ACQUISITION_AMORTIZATION", pattern: /Amortization of acquisition-related intangibles/i, canonicalMetric: "expense.acquisition_intangibles_amortization" },
  { ruleId: "ALIAS_SEGMENT_OPERATING_PROFIT", pattern: /segment operating profit/i, canonicalMetric: "segment_profit.operating" },
  { ruleId: "ALIAS_NET_PROCEEDS", pattern: /^net proceeds/i, canonicalMetric: "financing.net_proceeds" },
  { ruleId: "ALIAS_PENSION_CONTRIBUTIONS", pattern: /pension contributions/i, canonicalMetric: "pension.contributions" },
  { ruleId: "ALIAS_PENSION_COST", pattern: /net pension and postretirement cost/i, canonicalMetric: "pension.net_cost" },
  { ruleId: "ALIAS_FREE_CASH_FLOW_PRODUCTIVITY", pattern: /adjusted free cash flow productivity/i, canonicalMetric: "free_cash_flow.productivity.adjusted" },
  { ruleId: "ALIAS_FREE_CASH_FLOW", pattern: /^free cash flow\b/i, canonicalMetric: "free_cash_flow" },
  { ruleId: "ALIAS_OPERATING_CASH_FLOW", pattern: /cash from operations|cash flows from operations|Cash provided by operating activities/i, canonicalMetric: "operating_cash_flow" },
  { ruleId: "ALIAS_NET_SALES", pattern: /net sales/i, canonicalMetric: "revenue.net_sales" },
  { ruleId: "ALIAS_NET_REVENUE", pattern: /net revenue/i, canonicalMetric: "revenue.net" },
  { ruleId: "ALIAS_REVENUE_GROWTH", pattern: /revenue growth|sales growth/i, canonicalMetric: "revenue.growth" },
  { ruleId: "ALIAS_ORGANIC_SALES", pattern: /organic sales/i, canonicalMetric: "revenue.organic_sales" },
  { ruleId: "ALIAS_TOTAL_SALES", pattern: /^total sales/i, canonicalMetric: "revenue.total_sales" },
  { ruleId: "ALIAS_COMPARABLE_SALES", pattern: /^comp_sales|^comps\b/i, canonicalMetric: "revenue.comparable_sales" },
  { ruleId: "ALIAS_SALES", pattern: /^sales\b/i, canonicalMetric: "revenue.sales" },
  { ruleId: "ALIAS_TAX_RATE", pattern: /tax rates?/i, canonicalMetric: (statement) => `tax_rate.effective.${basisSuffix(statement)}` },
  { ruleId: "ALIAS_GROSS_MARGIN", pattern: /gross margins?(?: percentage)?/i, canonicalMetric: (statement) => `margin.gross.${basisSuffix(statement)}` },
  { ruleId: "ALIAS_OPERATING_MARGIN", pattern: /operating margins?/i, canonicalMetric: (statement) => `margin.operating.${basisSuffix(statement)}` },
  { ruleId: "ALIAS_ADJUSTED_EBITDA", pattern: /adjusted EBITDA|Adj\. EBITDA/i, canonicalMetric: "ebitda.adjusted" },
  { ruleId: "ALIAS_NET_INCOME", pattern: /net (?:income|earnings)/i, canonicalMetric: (statement) => `net_income.${basisSuffix(statement)}` },
  { ruleId: "ALIAS_NET_LOSS", pattern: /^net loss/i, canonicalMetric: "net_loss" },
  { ruleId: "ALIAS_CONTINUING_OPERATIONS", pattern: /Income from continuing operations/i, canonicalMetric: "income.continuing_operations" },
  { ruleId: "ALIAS_ADJUSTED_EARNINGS", pattern: /^adjusted earnings/i, canonicalMetric: "net_income.non_gaap" },
  { ruleId: "ALIAS_CAPEX", pattern: /capital expenditures|capital spending|capital investments|^capex\b/i, canonicalMetric: "capex" },
  { ruleId: "ALIAS_OPEX", pattern: /operating expenses/i, canonicalMetric: "opex" },
  { ruleId: "ALIAS_FUEL_PRICE", pattern: /fuel price/i, canonicalMetric: "fuel.price" },
  { ruleId: "ALIAS_QUARTERLY_DIVIDEND", pattern: /^quarterly dividend/i, canonicalMetric: "dividend.quarterly" },
  { ruleId: "ALIAS_DIVIDEND_PER_SHARE", pattern: /cash dividend|dividends? per share|dividend rate/i, canonicalMetric: "dividend.per_share" },
  { ruleId: "ALIAS_DIVIDENDS", pattern: /^dividends?\b/i, canonicalMetric: "capital_returns.dividends" },
  { ruleId: "ALIAS_PROFIT_SHARING", pattern: /profit sharing expense/i, canonicalMetric: "expense.profit_sharing" },
  { ruleId: "ALIAS_SHARE_REPURCHASES", pattern: /share repurchases/i, canonicalMetric: "capital_returns.share_repurchases" },
  { ruleId: "ALIAS_TRANSACTION_CLOSE", pattern: /transaction close timing/i, canonicalMetric: "timing.transaction_close" },
  { ruleId: "ALIAS_NET_OIL_PRODUCTION", pattern: /net oil-equivalent production/i, canonicalMetric: "production.oil_equivalent" },
  { ruleId: "ALIAS_ENDING_SUBSCRIBERS", pattern: /ending subscribers/i, canonicalMetric: "subscribers.ending" },
  { ruleId: "ALIAS_SYSTEM_CAPACITY", pattern: /system capacity/i, canonicalMetric: "infrastructure.system_capacity" },
  { ruleId: "ALIAS_PRODUCTION", pattern: /^production\b/i, canonicalMetric: "operations.production" },
  { ruleId: "ALIAS_DEPRECIATION", pattern: /^depreciation\b/i, canonicalMetric: "depreciation" },
  { ruleId: "ALIAS_REVENUE", pattern: /^revenues?\b/i, canonicalMetric: "revenue" },
];

export function canonicalMetricFor(
  statement: ExpectationStatement,
  context: { ticker: string; industry?: string },
): { canonicalMetric: string; aliasRuleId: string | null } {
  const industry = context.industry ?? COMPANY_INDUSTRY[context.ticker];
  const raw = `${statement.metricRaw}\n${statement.scopeRaw}`;
  const alias = ALIASES.find((candidate) => candidate.pattern.test(raw)
    && (!candidate.industries || candidate.industries.includes(industry ?? ""))
    && (!candidate.tickers || candidate.tickers.includes(context.ticker)));
  if (alias) {
    return {
      canonicalMetric: typeof alias.canonicalMetric === "function" ? alias.canonicalMetric(statement) : alias.canonicalMetric,
      aliasRuleId: alias.ruleId,
    };
  }
  return { canonicalMetric: statement.metric === "other" ? "other.unmapped" : statement.metric, aliasRuleId: null };
}
