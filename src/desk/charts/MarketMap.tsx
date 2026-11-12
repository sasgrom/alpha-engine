/**
 * Market map: every company as a tile, grouped by sector, sized by market cap (or equally), colored by its return
 * over the chosen period on the blue/red diverging scale (gray = flat or no data). Tiles are separated by a 2px
 * surface gap; labels sit inside a tile only when they fit. The table view on the page carries every value too.
 */
import { useMemo, useState, type MouseEvent } from "react";
import type { DeskCompany, DeskPeriod } from "@contracts/desk-snapshot";
import { fmtCap, fmtPct, fmtPrice } from "../format";
import { DIVERGING_LIMIT, divergingColor, labelInk, type ChartPalette } from "./color";
import { useWidth } from "./scale";
import { squarify, type Tile } from "./squarify";

interface SectorGroup {
  name: string;
  members: DeskCompany[];
  value: number;
}

export function MarketMap({
  companies,
  period,
  sizeBy,
  height,
  palette,
  onOpen,
}: {
  companies: DeskCompany[];
  period: DeskPeriod;
  sizeBy: "cap" | "equal";
  height: number;
  palette: ChartPalette;
  onOpen: (company: DeskCompany) => void;
}) {
  const [ref, width, node] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ company: DeskCompany; x: number; y: number } | null>(null);
  const weight = (company: DeskCompany) => (sizeBy === "equal" ? 1 : company.marketCap ?? 0);

  const layout = useMemo(() => {
    if (width <= 0) return { sectors: [] as Tile<SectorGroup>[], tiles: [] as Tile<DeskCompany>[] };
    const groups = new Map<string, DeskCompany[]>();
    for (const company of companies) if (weight(company) > 0) groups.set(company.sector, [...(groups.get(company.sector) ?? []), company]);
    const sectors = squarify(
      [...groups].map(([name, members]) => ({ value: members.reduce((sum, member) => sum + weight(member), 0), item: { name, members, value: 0 } })),
      { x: 0, y: 0, w: width, h: height },
    );
    const tiles: Tile<DeskCompany>[] = [];
    for (const sector of sectors) {
      const header = sector.h > 46 && sector.w > 72 ? 19 : 0;
      tiles.push(...squarify(sector.item.members.map((member) => ({ value: weight(member), item: member })), { x: sector.x + 1, y: sector.y + header + 1, w: sector.w - 2, h: sector.h - header - 2 }));
    }
    return { sectors, tiles };
    // weight depends on sizeBy only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, sizeBy, width, height]);

  const limit = DIVERGING_LIMIT[period];
  const onMove = (event: MouseEvent<HTMLDivElement>, company: DeskCompany) => {
    const box = node.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ company, x: event.clientX - box.left, y: event.clientY - box.top });
  };

  return (
    <div ref={ref} className="desk-map" style={{ height }} onMouseLeave={() => setHover(null)}>
      {layout.sectors.map((sector) =>
        sector.h > 46 && sector.w > 72 ? (
          <div key={sector.item.name} className="desk-map-sector" style={{ left: sector.x, top: sector.y, width: sector.w }}>
            {sector.item.name}
          </div>
        ) : null,
      )}
      {layout.tiles.map((tile) => {
        const company = tile.item;
        const value = company.returns[period];
        const fill = divergingColor(value, limit, palette);
        const w = Math.max(0, tile.w - 2);
        const h = Math.max(0, tile.h - 2);
        const showTicker = w >= 30 && h >= 16;
        const showValue = w >= 42 && h >= 32;
        const size = Math.max(10, Math.min(22, Math.min(w / 4.2, h / 3)));
        return (
          <div
            key={company.cik}
            className="desk-map-tile"
            role="button"
            tabIndex={-1}
            aria-label={`${company.ticker} ${company.name}: ${fmtPct(value, 2)}`}
            style={{ left: tile.x + 1, top: tile.y + 1, width: w, height: h, background: fill, color: labelInk(fill) }}
            onMouseMove={(event) => onMove(event, company)}
            onClick={() => onOpen(company)}
          >
            {showTicker && <b style={{ fontSize: size }}>{company.ticker}</b>}
            {showValue && <span style={{ fontSize: Math.max(10, size * 0.62) }}>{fmtPct(value, value !== null && Math.abs(value) >= 0.1 ? 0 : 1)}</span>}
          </div>
        );
      })}
      {hover && (
        <div className="desk-tooltip" style={{ left: hover.x > width * 0.6 ? hover.x - 230 : hover.x + 16, top: Math.min(hover.y + 12, height - 120), width: 214 }}>
          <strong>{fmtPct(hover.company.returns[period], 2)}</strong>
          <div style={{ color: "var(--d-ink)", fontWeight: 600 }}>{hover.company.ticker} · {hover.company.name}</div>
          <div>{hover.company.sector}</div>
          <div className="row"><span>Close</span><span>{fmtPrice(hover.company.close)}</span></div>
          <div className="row"><span>Market cap</span><span>{fmtCap(hover.company.marketCap)}</span></div>
        </div>
      )}
    </div>
  );
}

export function DivergingLegend({ period, palette }: { period: DeskPeriod; palette: ChartPalette }) {
  const limit = DIVERGING_LIMIT[period];
  const stops = Array.from({ length: 11 }, (_, k) => divergingColor(((k - 5) / 5) * limit, limit, palette));
  return (
    <div aria-label={`Color scale from ${fmtPct(-limit, 0)} to ${fmtPct(limit, 0)}`}>
      <div className="desk-gradient" style={{ background: `linear-gradient(90deg, ${stops.join(", ")})` }} />
      <div className="desk-gradient-scale">
        <span>{fmtPct(-limit, 0)}</span>
        <span>0%</span>
        <span>{fmtPct(limit, 0)}</span>
      </div>
    </div>
  );
}
