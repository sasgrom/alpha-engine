export interface FlowFund { cik: number; name: string; tier: string | null }
export interface FlowCompany { cik: number; ticker: string; sector: string | null }
export interface FlowEdge { fundCik: number; cik: number; curUsd: number; deltaUsd: number; curShares: number; deltaShares: number; deltaWeightPp: number | null }

export const TIER_ORDER = ["activist", "quant", "fundamental", "passive", "institutional"] as const;

export function selectFlowEdges(edges: FlowEdge[], limit = 150): FlowEdge[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Flow edge limit must be a positive integer");
  return edges
    .map((edge, index) => ({ edge, index, magnitude: Math.abs(edge.deltaShares) }))
    .sort((a, b) => b.magnitude - a.magnitude || a.index - b.index)
    .slice(0, Math.min(limit, edges.length))
    .map(({ edge }) => edge);
}

export function groupFundsByTier(funds: FlowFund[]): Map<string, FlowFund[]> {
  const groups = new Map<string, FlowFund[]>();
  for (const tier of TIER_ORDER) groups.set(tier, funds.filter((fund) => (fund.tier ?? "institutional") === tier));
  return groups;
}

export function groupCompaniesBySector(companies: FlowCompany[]): Map<string, FlowCompany[]> {
  const groups = new Map<string, FlowCompany[]>();
  for (const company of companies) {
    const sector = company.sector ?? "Unclassified";
    groups.set(sector, [...(groups.get(sector) ?? []), company]);
  }
  return groups;
}

export function flowEdgeText(edge: FlowEdge, fund: FlowFund | undefined, company: FlowCompany | undefined): string {
  return `${fund?.name ?? String(edge.fundCik)} ${company?.ticker ?? String(edge.cik)} ${company?.sector ?? ""}`.toLowerCase();
}

export function supportsWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

export function signed(value: number, fractionDigits = 1): string {
  const absolute = Math.abs(value);
  const formatted = absolute >= 1e9 ? `${(value / 1e9).toFixed(fractionDigits)}B` : absolute >= 1e6 ? `${(value / 1e6).toFixed(fractionDigits)}M` : absolute >= 1e3 ? `${(value / 1e3).toFixed(fractionDigits)}K` : value.toFixed(fractionDigits);
  return value > 0 ? `+${formatted}` : formatted;
}
