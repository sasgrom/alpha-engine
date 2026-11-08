import type { ExpectationStatement } from "./expectations";

export const COMPANY_INDUSTRY: Record<string, string> = {
  NVDA: "semiconductors",
  META: "interactive_media",
  AMZN: "consumer_technology",
  MSFT: "software",
  GOOGL: "interactive_media",
  JPM: "banks",
  WMT: "retail",
  PFE: "pharmaceuticals",
  UNH: "managed_care",
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
  { ruleId: "ALIAS_EPS_DILUTED", pattern: /diluted (?:earnings|earnings per|EPS)|earnings per diluted|(?:GAAP|non-GAAP) EPS|earnings per share/i, canonicalMetric: (statement) => `eps.diluted.${basisSuffix(statement)}` },
  { ruleId: "ALIAS_NET_SALES", pattern: /net sales/i, canonicalMetric: "revenue.net_sales" },
  { ruleId: "ALIAS_NET_REVENUE", pattern: /net revenue/i, canonicalMetric: "revenue.net" },
  { ruleId: "ALIAS_SALES_GROWTH", pattern: /sales growth/i, canonicalMetric: "revenue.growth" },
  { ruleId: "ALIAS_TAX_RATE", pattern: /tax rates?/i, canonicalMetric: (statement) => `tax_rate.effective.${basisSuffix(statement)}` },
  { ruleId: "ALIAS_GROSS_MARGIN", pattern: /gross margins?(?: percentage)?/i, canonicalMetric: (statement) => `margin.gross.${basisSuffix(statement)}` },
  { ruleId: "ALIAS_OPERATING_MARGIN", pattern: /operating margins?/i, canonicalMetric: (statement) => `margin.operating.${basisSuffix(statement)}` },
  { ruleId: "ALIAS_ADJUSTED_EBITDA", pattern: /adjusted EBITDA/i, canonicalMetric: "ebitda.adjusted" },
  { ruleId: "ALIAS_NET_INCOME", pattern: /net (?:income|earnings)/i, canonicalMetric: (statement) => `net_income.${basisSuffix(statement)}` },
  { ruleId: "ALIAS_ADJUSTED_EARNINGS", pattern: /^adjusted earnings/i, canonicalMetric: "net_income.non_gaap" },
  { ruleId: "ALIAS_CAPEX", pattern: /capital expenditures|capital spending|^capex\b/i, canonicalMetric: "capex" },
  { ruleId: "ALIAS_OPEX", pattern: /operating expenses/i, canonicalMetric: "opex" },
  { ruleId: "ALIAS_OPERATING_CASH_FLOW", pattern: /cash from operations/i, canonicalMetric: "operating_cash_flow" },
  { ruleId: "ALIAS_SALES", pattern: /^sales\b/i, canonicalMetric: "revenue.sales" },
  { ruleId: "ALIAS_DASH_MARKETPLACE_GOV", pattern: /Marketplace GOV/i, canonicalMetric: "marketplace.gov", tickers: ["DASH"] },
  { ruleId: "ALIAS_RCL_NET_YIELD", pattern: /Net Yields/i, canonicalMetric: "cruise.net_yield", tickers: ["RCL"] },
  { ruleId: "ALIAS_RCL_NET_CRUISE_COST", pattern: /Net Cruise Costs per APCD/i, canonicalMetric: "cruise.net_cost_per_apcd", tickers: ["RCL"] },
  { ruleId: "ALIAS_OPERATING_EPS", pattern: /Operating EPS/i, canonicalMetric: "eps.operating" },
  { ruleId: "ALIAS_DIVIDEND_PER_SHARE", pattern: /cash dividend|dividends per share/i, canonicalMetric: "dividend.per_share" },
  { ruleId: "ALIAS_PROFIT_SHARING", pattern: /profit sharing expense/i, canonicalMetric: "expense.profit_sharing" },
  { ruleId: "ALIAS_SHARE_REPURCHASES", pattern: /share repurchases/i, canonicalMetric: "capital_returns.share_repurchases" },
  { ruleId: "ALIAS_DIVIDENDS", pattern: /^dividends\b/i, canonicalMetric: "capital_returns.dividends" },
  { ruleId: "ALIAS_ENDING_SUBSCRIBERS", pattern: /ending subscribers/i, canonicalMetric: "subscribers.ending" },
  { ruleId: "ALIAS_SYSTEM_CAPACITY", pattern: /system capacity/i, canonicalMetric: "infrastructure.system_capacity" },
  { ruleId: "ALIAS_PRODUCTION", pattern: /^production\b/i, canonicalMetric: "operations.production" },
  { ruleId: "ALIAS_DEPRECIATION", pattern: /^depreciation\b/i, canonicalMetric: "depreciation" },
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
