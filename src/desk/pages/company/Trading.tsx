/**
 * The company page's trading (owner, 2026-11-28: volume flow per company and peers): a strip of the last sessions'
 * dollar volume against the company's usual day, under the price chart, and the measured peers. Peers are measured,
 * not taken from the sector label (PER_COMPANY_ENGINE.md §8): daily moves after the market correlate at 0.30 or more
 * over two years, and, the owner's business test, the two share an industry ETF. Files: scripts/build-flow-trading.mts.
 */
import { useState } from "react";
import type { DeskCompany } from "@contracts/desk-snapshot";
import { tradingColor, TRADING_HUE } from "../../charts/color";
import { useWidth } from "../../charts/scale";
import { CompanyLink, Delta } from "../../components";
import { useDesk } from "../../context";
import { useDeskSnapshot } from "../../data";
import { timesNormal, useFlowsTradingCompany } from "../../flows/data";
import { fmtCap, fmtDate } from "../../format";

/** The last 60 sessions' trading against usual: bar height = dollar volume, colour = against the usual day. */
export function TradingStrip({ cik }: { cik: number }) {
  const { palette, theme } = useDesk();
  const file = useFlowsTradingCompany(cik);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const days = (file.data?.days ?? []).slice(-60);
  if (file.isLoading || !days.length) return null;
  const hue = TRADING_HUE[theme.resolved === "dark" ? "dark" : "light"];
  const height = 46, max = Math.max(1, ...days.map((day) => day[1]));
  const band = width / days.length, bar = Math.max(1.5, band - 1.5);
  const latest = days[days.length - 1];
  const active = hover === null ? null : days[hover];
  return (
    <div style={{ marginTop: 10 }}>
      <div className="desk-muted" style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span>Trading, last {days.length} sessions · darker = more than its usual day</span>
        <span>{fmtDate(latest[0], "short")}: {fmtCap(latest[1])} · {timesNormal(latest[2])}</span>
      </div>
      <div ref={ref} className="desk-chart" style={{ height, position: "relative" }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`Dollar volume of the last ${days.length} sessions against the usual day`}>
            {days.map((day, index) => {
              const h = Math.max(1.5, (day[1] / max) * (height - 2));
              const fill = tradingColor(day[2], palette, hue);
              return (
                <rect key={day[0]} x={index * band} y={height - h} width={bar} height={h} rx={Math.min(2, bar / 2)} fill={fill === palette.mid ? palette.axis : fill} opacity={hover === null || hover === index ? 1 : 0.7} onMouseEnter={() => setHover(index)} />
              );
            })}
          </svg>
        )}
        {active && hover !== null && (
          <div className="desk-tooltip" style={{ left: Math.min(Math.max(0, hover * band - 70), Math.max(0, width - 200)), top: -6, transform: "translateY(-100%)" }}>
            <strong>{fmtDate(active[0], "short")}</strong>
            <div className="row"><span>Traded</span><span>{fmtCap(active[1])}</span></div>
            <div className="row"><span>Against usual</span><span>{timesNormal(active[2])}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Measured peers with this week's trading; the industry's largest companies only when nothing was measured. */
export function CompanyPeers({ cik, fallback }: { cik: number; fallback: DeskCompany[] }) {
  const file = useFlowsTradingCompany(cik);
  const snapshot = useDeskSnapshot();
  const byCik = new Map((snapshot.data?.companies ?? []).map((entry) => [entry.cik, entry]));
  const peers = file.data?.peers ?? null;
  if (file.isLoading) return null;
  if (!peers || !peers.list.length) {
    // no file (not built, or the server cannot read it) is not the same as "nothing moves with it"
    const note = !file.data
      ? "Measured peers are not available right now. The largest of its industry instead, not measured peers:"
      : "No company moves closely with it beyond the market (daily correlation 0.30 or more over two years). The largest of its industry instead, not measured peers:";
    return (
      <div>
        <p className="desk-muted" style={{ fontSize: 12.5, marginTop: 0 }}>{note}</p>
        {fallback.map((peer) => (
          <CompanyLink key={peer.cik} company={peer} className="desk-list-row">
            <span className="desk-list-main"><span className="desk-ticker" style={{ minWidth: 52 }}>{peer.ticker}</span><span className="name">{peer.name}</span></span>
            <span className="desk-list-side"><span className="desk-muted" style={{ fontSize: 12 }}>{fmtCap(peer.marketCap)}</span><Delta value={peer.returns.d1} digits={2} /></span>
          </CompanyLink>
        ))}
      </div>
    );
  }
  return (
    <div>
      <p className="desk-muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        {peers.basis === "confirmed" ? `Move with it beyond the market and share an industry fund (${peers.funds.join(", ")})` : "Move with it beyond the market (it sits in no industry fund, so the business check could not be made)"} · measured to {fmtDate(peers.quarter, "short")} · peers this week {timesNormal(peers.vsNormal)}
      </p>
      {peers.list.slice(0, 8).map((peer) => {
        const company = byCik.get(peer.cik);
        const side = (
          <span className="desk-list-side">
            <span className="desk-muted" style={{ fontSize: 12 }} title="Correlation of daily moves after the market, two years">{peer.corr.toFixed(2)}</span>
            <span style={{ fontSize: 12, minWidth: 74, textAlign: "right" }} title="This week's dollar volume against its usual week">{timesNormal(peer.vsNormal)}</span>
          </span>
        );
        return company ? (
          <CompanyLink key={peer.cik} company={company} className="desk-list-row">
            <span className="desk-list-main"><span className="desk-ticker" style={{ minWidth: 52 }}>{peer.ticker}</span><span className="name">{company.name}</span></span>
            {side}
          </CompanyLink>
        ) : (
          <div key={peer.cik} className="desk-list-row">
            <span className="desk-list-main"><span className="desk-ticker" style={{ minWidth: 52 }}>{peer.ticker}</span><span className="name desk-muted">not in the index</span></span>
            {side}
          </div>
        );
      })}
    </div>
  );
}
