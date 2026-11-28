/**
 * The money map's trading layer ("How it trades", owner 2026-11-28): the week timeline under the map, the week's panel
 * and the legend. Dollar volume has no direction (every share bought was sold); the only real money in and out shown
 * here is the ETF share counts. Figures come from scripts/build-flow-trading.mts (contracts/fund-flows.ts).
 */
import { useState } from "react";
import type { FlowTradingFile } from "@contracts/fund-flows";
import { tradingColor, type ChartPalette } from "../../charts/color";
import { useWidth } from "../../charts/scale";
import { fmtCap } from "../../format";
import { signedCap, timesNormal, weekLabel } from "../data";

export function WeekTimeline({ file, selected, onSelect, palette, hue, height = 52 }: { file: FlowTradingFile; selected: number; onSelect: (week: number) => void; palette: ChartPalette; hue: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const values = file.market.dollars.map((value) => value ?? 0);
  const max = Math.max(1, ...values);
  const band = file.weeks.length ? Math.max(0, width) / file.weeks.length : 0;
  const bar = Math.min(16, Math.max(2, band - 3));
  const top = height - 16;
  const active = hover === null ? null : hover;
  // a month is named at its first week; the first week shown only when the next month starts at least four weeks later
  const newMonth = (index: number) => index > 0 && file.weeks[index].end.slice(5, 7) !== file.weeks[index - 1].end.slice(5, 7);
  const firstNew = file.weeks.findIndex((_, index) => newMonth(index));
  const monthStart = (index: number) => newMonth(index) || (index === 0 && (firstNew < 0 || firstNew >= 4));
  return (
    <div ref={ref} className="desk-chart" style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Dollar volume of the covered companies, week by week; colour: against a usual week">
          {file.weeks.map((week, index) => {
            const h = Math.max(2, (values[index] / max) * (top - 4));
            const x = index * band + (band - bar) / 2;
            const isSelected = index === selected;
            return (
              <g key={week.end} onMouseEnter={() => setHover(index)} onClick={() => onSelect(index)} style={{ cursor: "pointer" }}>
                <rect x={index * band} y={0} width={band} height={height} fill={isSelected ? palette.accent : "transparent"} fillOpacity={isSelected ? 0.1 : 0} />
                <rect x={x} y={top - h} width={bar} height={h} rx={Math.min(3, bar / 2)} fill={tradingColor(file.market.vsNormal[index], palette, hue) === palette.mid ? palette.axis : tradingColor(file.market.vsNormal[index], palette, hue)} opacity={isSelected || hover === index ? 1 : 0.8} />
                {monthStart(index) && band * 4 > 26 && <text className="desk-axis-text" x={index * band + 1} y={height - 4}>{new Date(`${week.end}T12:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" })}</text>}
              </g>
            );
          })}
        </svg>
      )}
      {active !== null && (
        <div className="desk-tooltip" style={{ left: Math.min(Math.max(0, active * band - 70), Math.max(0, width - 220)), top: -6, transform: "translateY(-100%)" }}>
          <strong>{weekLabel(file.weeks[active].end)}</strong>
          <div className="row"><span>Traded</span><span>{fmtCap(file.market.dollars[active] ?? 0)}</span></div>
          <div className="row"><span>Against a usual week</span><span>{timesNormal(file.market.vsNormal[active])}</span></div>
          <div className="row"><span>Sessions</span><span>{file.weeks[active].sessions}</span></div>
        </div>
      )}
    </div>
  );
}

/** The week in numbers: the sectors' share of trading and their sector fund's money in or out, the busiest companies. */
export function TradingPanel({ file, week, tickers, onSector, onCompany, focus }: { file: FlowTradingFile; week: number; tickers: Map<number, string>; onSector: (name: string) => void; onCompany: (cik: number) => void; focus: string | null }) {
  const etf = new Map(file.etf.map((entry) => [entry.fund, entry]));
  const sectors = [...file.sectors].sort((a, b) => (b.share[week] ?? 0) - (a.share[week] ?? 0));
  const busiest = file.companies
    .filter(([, dollars, vs]) => vs[week] !== null && (dollars[week] ?? 0) > 0)
    .sort((a, b) => (b[2][week] ?? 0) - (a[2][week] ?? 0))
    .slice(0, 12);
  const funds = file.etf.filter((entry) => entry.group !== "sector" && (entry.dollars[week] ?? 0) !== 0);
  const anyEtf = file.etf.some((entry) => entry.dollars[week] !== null);
  return (
    <div className="desk-trading-panel" style={{ display: "grid", gap: 14 }}>
      <p className="desk-muted" style={{ margin: 0, fontSize: 12.5 }}>
        {weekLabel(file.weeks[week].end)}: the covered companies traded <strong>{fmtCap(file.market.dollars[week] ?? 0)}</strong>, {timesNormal(file.market.vsNormal[week])}. Trading has no direction (every share bought was sold); money in and out shows only in the ETF share counts.
      </p>
      <div className="desk-table-wrap">
        <table className="desk-table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th scope="col">Sector</th>
              <th scope="col" className="num" title="Share of all the covered companies' dollar volume">Share</th>
              <th scope="col" className="num" title="The sector's dollar volume against its usual week">vs usual</th>
              <th scope="col" className="num" title="Money into (+) or out of (−) the sector's SPDR fund, from its share count">Fund flow</th>
            </tr>
          </thead>
          <tbody>
            {sectors.map((entry) => {
              const fund = etf.get(entry.fund);
              const flow = fund?.dollars[week] ?? null;
              return (
                <tr key={entry.sector} aria-selected={focus === entry.sector}>
                  <th scope="row" style={{ whiteSpace: "normal" }}><button type="button" className="desk-link" style={{ border: "none", background: "transparent", padding: 0, font: "inherit", cursor: "pointer", textAlign: "left" }} onClick={() => onSector(entry.sector)}>{entry.sector}</button></th>
                  <td className="num">{entry.share[week] === null ? "—" : `${((entry.share[week] ?? 0) * 100).toFixed(1)}%`}</td>
                  <td className="num">{entry.vsNormal[week] === null ? "—" : `${(entry.vsNormal[week] ?? 0).toFixed(2)}×`}</td>
                  <td className="num" data-way={flow === null || flow === 0 ? undefined : flow > 0 ? "in" : "out"} title={`${entry.fund}: ${signedCap(flow)}`}>{flow === null ? "—" : shortFlow(flow)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!anyEtf && <p className="desk-muted" style={{ margin: 0, fontSize: 12 }}>Fund share counts start on 2026-11-11 (SPY and the sector funds) and 2026-11-28 (the industry funds); earlier weeks have none.</p>}
      {funds.length > 0 && (
        <div>
          <h3 style={{ margin: "0 0 6px", fontSize: 12.5, fontWeight: 600 }}>Money into the market and industry funds</h3>
          <ul style={{ display: "grid", gap: 3, margin: 0, padding: 0, listStyle: "none", fontSize: 12.5 }}>
            {funds.sort((a, b) => Math.abs(b.dollars[week] ?? 0) - Math.abs(a.dollars[week] ?? 0)).slice(0, 12).map((entry) => (
              <li key={entry.fund} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span><strong>{entry.fund}</strong> <span className="desk-muted">{entry.covers}</span></span>
                <span data-way={(entry.dollars[week] ?? 0) > 0 ? "in" : (entry.dollars[week] ?? 0) < 0 ? "out" : undefined}>{signedCap(entry.dollars[week])}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 style={{ margin: "0 0 6px", fontSize: 12.5, fontWeight: 600 }}>Traded most against usual</h3>
        <ul style={{ display: "grid", gap: 3, margin: 0, padding: 0, listStyle: "none", fontSize: 12.5 }}>
          {busiest.map(([cik, dollars, vs]) => (
            <li key={cik} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <button type="button" className="desk-link" style={{ border: "none", background: "transparent", padding: 0, font: "inherit", cursor: "pointer" }} onClick={() => onCompany(cik)}>{tickers.get(cik) ?? cik}</button>
              <span>{timesNormal(vs[week])} · {fmtCap(dollars[week] ?? 0)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="desk-muted" style={{ margin: 0, fontSize: 11.5 }}>Dollar volume = shares traded × close, from the stored daily Schwab bars. Usual = the median day of the 20 sessions before the week. Fund flows = change in shares outstanding × price, as Schwab reported the counts between two captures; the session each change belongs to is still being measured.</p>
    </div>
  );
}

export function TradingLegend({ palette, hue }: { palette: ChartPalette; hue: string }) {
  const steps = [1, 1.41, 2, 2.83, 4];
  return (
    <div className="desk-lib-legend">
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        usual
        {steps.map((step) => <span key={step} aria-hidden="true" style={{ width: 14, height: 10, borderRadius: 2, background: tradingColor(step, palette, hue), display: "inline-block" }} />)}
        4× usual or more
      </span>
      <span className="desk-lib-legend-note">tiles: how much the company traded this week against a usual week (dollar volume) · trading has no direction · sector line: its share of all trading</span>
    </div>
  );
}


/** −55,900,000 → "−$56M": the sector table's narrow column; the exact figure is in the cell's title. */
export function shortFlow(value: number): string {
  const abs = Math.abs(value), sign = value < 0 ? "−" : value > 0 ? "+" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${Math.round(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs)}`;
}