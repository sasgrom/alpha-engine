/**
 * The money map's ground plan: sectors as districts, companies as tiles, sized by what the tracked funds hold in the
 * latest quarter. The plan is the same for every quarter (a map that moves under the reader is no map); quarters only
 * recolour it. Pure and testable; MoneyMap.tsx draws it.
 */
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { FLOW_OUTSIDE, type FundFlowsOverview } from "@contracts/fund-flows";

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface District extends Rect { name: string; held: number }
export interface Tile extends Rect { cik: number; ticker: string; name: string; sector: string; held: number }
export interface MapPlan {
  width: number;
  height: number;
  districts: District[];
  tiles: Tile[];
  tileByCik: Map<number, Tile>;
  districtByName: Map<string, District>;
  /** Where money from and to outside the covered stocks enters the map: below its bottom edge, in the middle. */
  outside: { x: number; y: number };
}

/** Room under the map for the outside gate and its label. */
export const MAP_FOOT = 34;
const LABEL = 22;

interface Node { name: string; cik?: number; ticker?: string; title?: string; held?: number; children?: Node[] }

export function buildMapPlan(overview: Pick<FundFlowsOverview, "companies" | "sectorNames">, width: number, height: number): MapPlan {
  const bySector = new Map<string, Node[]>();
  for (const company of overview.companies) {
    if (!(company.held > 0)) continue;
    const list = bySector.get(company.sector) ?? [];
    list.push({ name: company.ticker, cik: company.cik, ticker: company.ticker, title: company.name, held: company.held });
    bySector.set(company.sector, list);
  }
  // the hall's sector order (largest holding first), then any sector it does not name
  const order = [...overview.sectorNames.filter((name) => bySector.has(name)), ...[...bySector.keys()].filter((name) => !overview.sectorNames.includes(name)).sort()];
  const root = hierarchy<Node>({ name: "map", children: order.map((name) => ({ name, children: bySector.get(name)! })) })
    .sum((node) => node.held ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const plotHeight = Math.max(100, height - MAP_FOOT);
  treemap<Node>().tile(treemapSquarify.ratio(1.4)).size([width, plotHeight]).paddingOuter(3).paddingTop((node) => (node.depth === 1 ? LABEL : 3)).paddingInner((node) => (node.depth === 0 ? 5 : 1.5)).round(false)(root);

  const districts: District[] = [];
  const tiles: Tile[] = [];
  for (const sector of root.children ?? []) {
    const box = sector as unknown as Rect;
    districts.push({ name: sector.data.name, held: sector.value ?? 0, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 });
    for (const leaf of sector.children ?? []) {
      const r = leaf as unknown as Rect;
      tiles.push({ cik: leaf.data.cik!, ticker: leaf.data.ticker!, name: leaf.data.title!, sector: sector.data.name, held: leaf.value ?? 0, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
    }
  }
  return {
    width, height, districts, tiles,
    tileByCik: new Map(tiles.map((tile) => [tile.cik, tile])),
    districtByName: new Map(districts.map((district) => [district.name, district])),
    outside: { x: width / 2, y: plotHeight + MAP_FOOT * 0.55 },
  };
}

/** The point a sector's money leaves from or arrives at: the district's middle, or the outside gate. */
export function anchorOf(plan: MapPlan, sector: string): { x: number; y: number } | null {
  if (sector === FLOW_OUTSIDE) return plan.outside;
  const district = plan.districtByName.get(sector);
  return district ? { x: (district.x0 + district.x1) / 2, y: (district.y0 + district.y1) / 2 + LABEL / 2 } : null;
}

/**
 * Where each person stands: in the district of the fund's home sector (the hall's `places`), on a spiral around its
 * middle so that people of one district do not cover each other; a fund without a home stands by the outside gate.
 * `spacing` is in map units at zoom 1.
 */
export function placePeople(plan: MapPlan, homes: Map<number, string | null>, order: number[], spacing = 40): Map<number, { x: number; y: number }> {
  const out = new Map<number, { x: number; y: number }>();
  const used = new Map<string, number>();
  for (const cik of order) {
    const home = homes.get(cik) ?? null;
    const district = home ? plan.districtByName.get(home) : undefined;
    const key = district ? district.name : "outside";
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    const centre = district ? { x: (district.x0 + district.x1) / 2, y: (district.y0 + district.y1) / 2 + LABEL / 2 } : { x: plan.outside.x + (n - 2) * spacing, y: plan.outside.y };
    if (!district) { out.set(cik, centre); continue; }
    // golden-angle spiral, clamped inside the district
    const angle = n * 2.39996;
    const radius = spacing * 0.62 * Math.sqrt(n);
    const x = Math.min(district.x1 - spacing / 2, Math.max(district.x0 + spacing / 2, centre.x + Math.cos(angle) * radius));
    const y = Math.min(district.y1 - spacing / 2, Math.max(district.y0 + LABEL + spacing / 2, centre.y + Math.sin(angle) * radius));
    out.set(cik, { x, y });
  }
  return out;
}

/** Initials of a person or a firm for its pin: "Warren Buffett" → "WB", "BlackRock" → "BL". */
export function initialsOf(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 &.-]/g, " ").split(/\s+/).filter((word) => word && !/^(inc|llc|lp|ltd|co|corp|the|of|and|&)\.?$/i.test(word));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}
