/**
 * Sector returns as diverging bars from one shared zero line: blue to the right for gains, red to the left for
 * losses, the value printed at the bar's tip, a per-row tooltip with breadth. Rows are buttons that open the
 * screener on that sector.
 */
import { useState } from "react";
import type { DeskPeriod, DeskSector } from "@contracts/desk-snapshot";
import { fmtCap, fmtPct } from "../format";
import type { ChartPalette } from "./color";

export function SectorBars({ sectors, period, palette, onSelect }: { sectors: DeskSector[]; period: DeskPeriod; palette: ChartPalette; onSelect?: (sector: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const rows = sectors.filter((sector) => sector.returns[period] !== null).sort((a, b) => b.returns[period]! - a.returns[period]!);
  const max = Math.max(0.005, ...rows.map((sector) => Math.abs(sector.returns[period]!)));
  return (
    <div style={{ display: "grid", gap: 2 }}>
      {rows.map((sector) => {
        const value = sector.returns[period]!;
        const share = (Math.abs(value) / max) * 50;
        const positive = value >= 0;
        return (
          <button
            key={sector.name}
            type="button"
            className="desk-list-row"
            style={{ gridTemplateColumns: "minmax(110px, 1.1fr) minmax(80px, 2fr) 62px", padding: "6px 4px", position: "relative" }}
            onMouseEnter={() => setHover(sector.name)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(sector.name)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect?.(sector.name)}
            aria-label={`${sector.name}: ${fmtPct(value, 2)}, ${sector.advancers} up, ${sector.decliners} down`}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{sector.name}</span>
            <span style={{ position: "relative", height: 14 }} aria-hidden="true">
              <span style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, background: palette.axis }} />
              <span
                style={{
                  position: "absolute",
                  top: 1,
                  height: 12,
                  left: positive ? "50%" : `${50 - share}%`,
                  width: `${share}%`,
                  background: positive ? palette.pos : palette.neg,
                  borderRadius: positive ? "0 4px 4px 0" : "4px 0 0 4px",
                }}
              />
            </span>
            <span className={`desk-num ${positive ? "desk-up" : "desk-down"}`} style={{ textAlign: "right", fontSize: 13, fontWeight: 560 }}>{fmtPct(value, 2)}</span>
            {hover === sector.name && (
              <span className="desk-tooltip" style={{ right: 70, top: -50, minWidth: 190 }}>
                <strong>{fmtPct(value, 2)}</strong>
                {sector.name}
                <span className="row"><span>Companies</span><span>{sector.companies}</span></span>
                <span className="row"><span>Up / down today</span><span>{sector.advancers} / {sector.decliners}</span></span>
                <span className="row"><span>Market cap</span><span>{fmtCap(sector.marketCap)}</span></span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
