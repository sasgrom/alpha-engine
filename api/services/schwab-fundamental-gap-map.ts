import type { SchwabContextReport, SchwabInstrumentProfile } from "../../worker/lib/schwab-context";
import type { EdgarGapAnalysis } from "./edgar-gap-analysis";
export type SchwabGapCandidateStatus = "direct_candidate" | "derived_candidate" | "unsupported";
export type SchwabGapUsage = "current_provider_feature" | "derived_current_provider_feature" | "none";
export interface SchwabGapCandidate { cik: number; concept: string; status: SchwabGapCandidateStatus; usage: SchwabGapUsage; schwabFields: string[]; formula: string | null; capturedAt: string | null; sourceHash: string | null; reason: string }
export interface SchwabFundamentalGapMap { schemaVersion: 1; generatedAt: string; sourceGapGeneratedAt: string; coverage: { direct: number; derived: number; unsupported: number }; candidates: SchwabGapCandidate[] }
const unsupported = (concept: string, reason: string): SchwabGapCandidate => ({ cik: 0, concept, status: "unsupported", usage: "none", schwabFields: [], formula: null, capturedAt: null, sourceHash: null, reason });
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
    cik: 0, concept, status,
    usage: status === "derived_candidate" ? "derived_current_provider_feature" : "current_provider_feature",
    schwabFields: available,
    formula: mapped.formula ?? null,
    capturedAt: null,
    sourceHash: null,
    reason: status === "derived_candidate"
      ? "Use only as a snapshot-anchored derived provider feature; it is not an exact EDGAR replacement or vintage-equivalent fact."
      : "Use as a snapshot-anchored provider feature; do not relabel it as EDGAR vintage history.",
  };
}

export function buildSchwabFundamentalGapMap(gaps: EdgarGapAnalysis, context: SchwabContextReport, tickerByCik: Record<number, string>, generatedAt: string): SchwabFundamentalGapMap {
  const concepts = [...new Set(gaps.gaps.map((gap) => gap.concept))].sort();
  const profiles = new Map(context.instruments.map((profile) => [profile.symbol, profile]));
  const candidates = concepts.map((concept) => {
    const gap = gaps.gaps.find((item) => item.concept === concept);
    const symbol = gap ? tickerByCik[gap.cik] : undefined;
    const profile = symbol ? profiles.get(symbol) : undefined;
    const mapped = mapSchwabFundamentalGap(concept, profile);
    const evidence = symbol && mapped.status !== "unsupported"
      ? context.files.find((file) => file.kind === `instrument/${symbol}` && file.status === "complete")
      : undefined;
    return { ...mapped, cik: gap?.cik ?? 0, capturedAt: evidence?.capturedAt ?? null, sourceHash: evidence?.sourceHash ?? null };
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
