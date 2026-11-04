export const MACRO_RESEARCH_START = "2000-01-01";
export type MacroGroup = "rates" | "oil" | "usd" | "credit" | "volatility" | "inflation" | "labor" | "growth";
export interface MacroSeriesDefinition {
  seriesId: string;
  group: MacroGroup;
  channel: string;
  notes?: string;
}

export const MACRO_GROUP_ORDER: MacroGroup[] = ["rates", "oil", "usd", "credit", "volatility", "inflation", "labor", "growth"];
export const MACRO_SERIES: MacroSeriesDefinition[] = [
  { seriesId: "DGS2", group: "rates", channel: "treasury_2y" },
  { seriesId: "DGS10", group: "rates", channel: "treasury_10y" },
  { seriesId: "DGS30", group: "rates", channel: "treasury_30y" },
  { seriesId: "T10Y2Y", group: "rates", channel: "yield_curve_10y_2y" },
  { seriesId: "SOFR", group: "rates", channel: "secured_overnight_financing" },
  { seriesId: "DFF", group: "rates", channel: "effective_federal_funds" },
  { seriesId: "FEDFUNDS", group: "rates", channel: "effective_federal_funds_monthly", notes: "Monthly effective federal funds rate; distinct from DFF daily observations." },
  { seriesId: "MORTGAGE30US", group: "rates", channel: "mortgage_30y" },
  { seriesId: "DCOILWTICO", group: "oil", channel: "wti_spot" },
  { seriesId: "DCOILBRENTEU", group: "oil", channel: "brent_spot" },
  { seriesId: "DTWEXBGS", group: "usd", channel: "fed_broad_dollar" },
  { seriesId: "BAMLC0A0CM", group: "credit", channel: "investment_grade_oas", notes: "FRED notes that starting in April 2026 this series includes only three years of observations; use the source for longer history." },
  { seriesId: "BAMLH0A0HYM2", group: "credit", channel: "high_yield_oas", notes: "FRED notes that starting in April 2026 this series includes only three years of observations; use the source for longer history." },
  { seriesId: "VIXCLS", group: "volatility", channel: "vix_close" },
  { seriesId: "CPIAUCSL", group: "inflation", channel: "cpi_headline" },
  { seriesId: "CPILFESL", group: "inflation", channel: "cpi_core" },
  { seriesId: "PCEPI", group: "inflation", channel: "pce_headline" },
  { seriesId: "PCEPILFE", group: "inflation", channel: "pce_core" },
  { seriesId: "PAYEMS", group: "labor", channel: "nonfarm_payrolls" },
  { seriesId: "UNRATE", group: "labor", channel: "unemployment_rate" },
  { seriesId: "GDPC1", group: "growth", channel: "real_gdp" },
  { seriesId: "GDP", group: "growth", channel: "nominal_gdp" },
];

export function realtimeResearchStart(firstVintage: string): string {
  return firstVintage > MACRO_RESEARCH_START ? firstVintage : MACRO_RESEARCH_START;
}

export function selectMacroSeries(group: string | null, seriesId: string | null): MacroSeriesDefinition[] {
  if (seriesId) {
    const normalized = seriesId.toUpperCase();
    const selected = MACRO_SERIES.filter((series) => series.seriesId === normalized);
    if (!selected.length) throw new Error(`Unknown FRED series ${normalized}; add it to macro-sources.ts deliberately.`);
    return selected;
  }
  if (group) {
    const normalized = group.toLowerCase();
    if (normalized === "all") return [...MACRO_SERIES];
    const selected = MACRO_SERIES.filter((series) => series.group === normalized);
    if (!selected.length) throw new Error(`Unknown macro group ${group}; use ${MACRO_GROUP_ORDER.join(", ")} or all.`);
    return selected;
  }
  return MACRO_SERIES.filter((series) => series.group === "rates");
}
