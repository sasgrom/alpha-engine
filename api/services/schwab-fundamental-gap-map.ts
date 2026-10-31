import type { SchwabContextReport, SchwabInstrumentProfile } from "../../worker/lib/schwab-context";
import type { EdgarGapAnalysis } from "./edgar-gap-analysis";
export type SchwabGapCandidateStatus = "direct_candidate" | "derived_candidate" | "unsupported";
export interface SchwabGapCandidate { cik: number; concept: string; status: SchwabGapCandidateStatus; schwabFields: string[]; formula: string | null; reason: string }
export interface SchwabFundamentalGapMap { schemaVersion: 1; generatedAt: string; sourceGapGeneratedAt: string; coverage: { direct: number; derived: number; unsupported: number }; candidates: SchwabGapCandidate[] }
const direct = (concept: string, fields: string[]): SchwabGapCandidate => ({ cik: 0, concept, status: "direct_candidate", schwabFields: fields, formula: null, reason: "Direct provider field exists, but it is current snapshot metadata, not EDGAR vintage history." });
const derived = (concept: string, fields: string[], formula: string, reason: string): SchwabGapCandidate => ({ cik: 0, concept, status: "derived_candidate", schwabFields: fields, formula, reason });
const unsupported = (concept: string, reason: string): SchwabGapCandidate => ({ cik: 0, concept, status: "unsupported", schwabFields: [], formula: null, reason });
const directMap = new Map<string, { fields: string[]; formula?: string; status?: SchwabGapCandidateStatus }>([
  ["EarningsPerShareDiluted", { fields: ["epsTTM", "eps"] }],
  ["EarningsPerShareBasicAndDiluted", { fields: ["epsTTM", "eps"] }],
  ["CommonStockSharesOutstanding", { fields: ["sharesOutstanding"] }],
  ["StockholdersEquity", { fields: ["bookValuePerShare", "sharesOutstanding"], formula: "bookValuePerShare × sharesOutstanding", status: "derived_candidate" }],
  ["NetIncomeLoss", { fields: ["epsTTM", "sharesOutstanding"], formula: "epsTTM × sharesOutstanding", status: "derived_candidate" }],
  ["NetCashProvidedByUsedInOperatingActivities", { fields: ["pcfRatio", "marketCap"], formula: "marketCap / pcfRatio", status: "derived_candidate" }],
  ["GrossProfit", { fields: ["grossMarginTTM", "grossMarginMRQ"], formula: "Margin ratio only; gross-profit dollars are not reconstructed", status: "derived_candidate" }],
  ["OperatingIncomeLoss", { fields: ["operatingMarginTTM", "operatingMarginMRQ"], formula: "Margin ratio only; operating-income dollars are not reconstructed", status: "derived_candidate" }],
  ["LongTermDebt", { fields: ["totalDebtToCapital", "totalDebtToEquity", "ltDebtToEquity"], formula: "Debt ratios only; debt dollars are not reconstructed", status: "derived_candidate" }],
  ["LongTermDebtNoncurrent", { fields: ["totalDebtToCapital", "totalDebtToEquity", "ltDebtToEquity"], formula: "Debt ratios only; debt dollars are not reconstructed", status: "derived_candidate" }],
  ["MarketCap", { fields: ["marketCap"] }],
  ["MarketCapFloat", { fields: ["marketCapFloat"] }],
  ["PriceToEarningsRatio", { fields: ["peRatio"] }],
  ["PriceToBookRatio", { fields: ["pbRatio"] }],
  ["PriceToCashFlowRatio", { fields: ["pcfRatio"] }],
  ["PriceToSalesRatio", { fields: ["prRatio"] }],
  ["PegRatio", { fields: ["pegRatio"] }],
  ["BookValuePerShare", { fields: ["bookValuePerShare"] }],
  ["Beta", { fields: ["beta"] }],
  ["ReturnOnEquity", { fields: ["returnOnEquity"] }],
  ["ReturnOnAssets", { fields: ["returnOnAssets"] }],
  ["ReturnOnInvestment", { fields: ["returnOnInvestment"] }],
  ["CurrentRatio", { fields: ["currentRatio"] }],
  ["QuickRatio", { fields: ["quickRatio"] }],
  ["InterestCoverage", { fields: ["interestCoverage"] }],
  ["GrossMargin", { fields: ["grossMarginTTM", "grossMarginMRQ"] }],
  ["OperatingMargin", { fields: ["operatingMarginTTM", "operatingMarginMRQ"] }],
  ["NetProfitMargin", { fields: ["netProfitMarginTTM", "netProfitMarginMRQ"] }],
  ["TotalDebtToEquity", { fields: ["totalDebtToEquity"] }],
  ["TotalDebtToCapital", { fields: ["totalDebtToCapital"] }],
  ["LtDebtToEquity", { fields: ["ltDebtToEquity"] }],
  ["DividendAmount", { fields: ["dividendAmount", "dividendPayAmount"] }],
  ["DividendYield", { fields: ["dividendYield"] }],
  ["DividendDate", { fields: ["dividendDate", "nextDividendDate", "dividendPayDate", "nextDividendPayDate"] }],
  ["DividendFreq", { fields: ["dividendFreq"] }],
  ["RevChangeTTM", { fields: ["revChangeTTM"] }],
  ["RevChangeYear", { fields: ["revChangeYear"] }],
  ["EpsChangePercentTTM", { fields: ["epsChangePercentTTM"] }],
  ["High52", { fields: ["high52"] }],
  ["Low52", { fields: ["low52"] }],
]);

export function mapSchwabFundamentalGap(concept: string, profile: SchwabInstrumentProfile | undefined): SchwabGapCandidate {
  if (!profile) return unsupported(concept, "No Schwab instrument profile exists for this ticker.");
  const mapped = directMap.get(concept);
  if (!mapped) return unsupported(concept, "No direct or defensible derived Schwab fundamental field exists for this XBRL concept.");
  const available = mapped.fields.filter((field) => field in profile.fundamental);
  if (!available.length) return unsupported(concept, "Schwab profile exists, but the required fundamental field is absent.");
  const status = mapped.status ?? "direct_candidate";
  return {
    cik: 0, concept, status, schwabFields: available,
    formula: mapped.formula ?? null,
    reason: status === "derived_candidate" ? "Derived only; never treat as an exact EDGAR replacement or vintage-equivalent fact." : "Direct provider field exists, but it is current snapshot metadata, not EDGAR vintage history.",
  };
}

export function buildSchwabFundamentalGapMap(gaps: EdgarGapAnalysis, context: SchwabContextReport, tickerByCik: Record<number, string>, generatedAt: string): SchwabFundamentalGapMap {
  const concepts = [...new Set(gaps.gaps.map((gap) => gap.concept))].sort();
  const profiles = new Map(context.instruments.map((profile) => [profile.symbol, profile]));
  const candidates = concepts.map((concept) => {
    const ticker = gaps.gaps.find((gap) => gap.concept === concept);
    const profile = ticker ? profiles.get(tickerByCik[ticker.cik]) : undefined;
    const mapped = mapSchwabFundamentalGap(concept, profile);
    return { ...mapped, cik: ticker?.cik ?? 0 };
  });
  return {
    schemaVersion: 1, generatedAt, sourceGapGeneratedAt: gaps.generatedAt,
    coverage: {
      direct: candidates.filter((candidate) => candidate.status === "direct_candidate").length,
      derived: candidates.filter((candidate) => candidate.status === "derived_candidate").length,
      unsupported: candidates.filter((candidate) => candidate.status === "unsupported").length,
    },
    candidates,
  };
}
