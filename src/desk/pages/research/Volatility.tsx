import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { DeskCompany } from "@contracts/desk-snapshot";
import { ScatterChart } from "../../charts/ScatterChart";
import { Card, CompanyLink, Delta, Kpi, Notice, Segmented, Shimmer } from "../../components";
import { useDesk, useDocumentTitle } from "../../context";
import { useDeskSnapshot } from "../../data";
import { DevNotes } from "../../DevNotes";
import { fmtDate, fmtNum, fmtPct, fmtPrice } from "../../format";
import { EvidenceNote, ResearchFrame } from "../../ResearchParts";

interface Row {
  company: DeskCompany;
  rv: number | null;
  iv1w: number | null;
  iv1m: number | null;
  iv3m: number | null;
  spread: number | null;
  slope: number | null;
  skew: number | null;
  putCall: number | null;
  move1w: number | null;
  move1m: number | null;
}

type SortKey = "spread" | "iv1m" | "rv" | "slope" | "skew" | "move1m";

function toRow(company: DeskCompany): Row {
  const bucket = (name: string) => company.options?.buckets.find((entry) => entry.bucket === name) ?? null;
  const week = bucket("1-7D");
  const month = bucket("8-30D");
  const quarter = bucket("31-90D");
  const rv = company.options?.rv20 ?? null;
  const iv1m = month?.atmIv ?? null;
  const iv3m = quarter?.atmIv ?? null;
  return {
    company,
    rv,
    iv1w: week?.atmIv ?? null,
    iv1m,
    iv3m,
    spread: iv1m !== null && rv !== null ? iv1m - rv : null,
    slope: iv3m !== null && iv1m !== null ? iv3m - iv1m : null,
    skew: month?.skew25 ?? null,
    putCall: month?.putCallOiRatio ?? null,
    move1w: week?.expectedMovePct ?? null,
    move1m: month?.expectedMovePct ?? null,
  };
}

/** Volatility points as "+3.2" (percentage points). */
function pts(value: number | null): string {
  return value === null ? "—" : fmtPct(value, 1).replace("%", "");
}

export default function Volatility() {
  useDocumentTitle("Volatility");
  const navigate = useNavigate();
  const { palette } = useDesk();
  const snapshot = useDeskSnapshot();
  const [sort, setSort] = useState<SortKey>("spread");
  const [focus, setFocus] = useState<string>("");
  const [source, setSource] = useState<"iv" | "rv">("iv");
  const [target, setTarget] = useState(20);
  const [capital, setCapital] = useState(100_000);
  const rows = useMemo(() => (snapshot.data?.companies ?? []).filter((company) => company.options).map(toRow), [snapshot.data]);
  const sorted = useMemo(() => [...rows].sort((a, b) => (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity)), [rows, sort]);
  const points = useMemo(() => rows.filter((row) => row.iv1m !== null && row.rv !== null).map((row) => ({ id: row.company.ticker, label: `${row.company.ticker} · ${row.company.name}`, x: row.rv!, y: row.iv1m! })), [rows]);
  const extremes = useMemo(() => {
    const bySpread = rows.filter((row) => row.spread !== null).sort((a, b) => b.spread! - a.spread!);
    return [...bySpread.slice(0, 3), ...bySpread.slice(-3)].map((row) => row.company.ticker);
  }, [rows]);

  if (snapshot.isLoading) return <ResearchFrame><Shimmer height={520} /></ResearchFrame>;
  if (snapshot.error) return <ResearchFrame><Notice title="The market snapshot could not be loaded">{snapshot.error.message}</Notice></ResearchFrame>;
  if (!rows.length) {
    return (
      <ResearchFrame>
        <Notice title="No option data in the snapshot">Option features are built for the research companies after each Schwab capture; rebuild the snapshot once they exist.</Notice>
        <DevNotes page="volatility" />
      </ResearchFrame>
    );
  }

  const selected = rows.find((row) => row.company.ticker === focus) ?? sorted[0];
  const forecast = source === "iv" ? selected.iv1m : selected.rv;
  const scalar = forecast ? Math.min(1, Math.max(0.25, target / 100 / forecast)) : null;
  const exposure = scalar === null ? null : capital * scalar;
  const captured = rows[0].company.options!.capturedAt.slice(0, 10);
  const richer = rows.filter((row) => (row.spread ?? 0) > 0).length;

  return (
    <ResearchFrame>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Research · option chains captured {fmtDate(captured)} · {rows.length} companies</span>
          <h1>Volatility</h1>
          <p className="desk-lede">How much movement the options price in, against how much each stock has actually moved. A forecast of size for sizing positions and reading reactions — not of direction.</p>
        </div>
      </div>

      <EvidenceNote family="iv-rv" />

      <div className="desk-kpis four">
        <Kpi label="Forecast quality (rank IC)" value="0.80" note="implied · 0.67 for realized" />
        <Kpi label="Outcome inside the expected move" value="62.3%" note="implied · 59.5% for realized" />
        <Kpi label="Volatility when sized by it" value="9.4% lower" note="9.03% against 9.98% a year" />
        <Kpi label="Options richer than realized" value={`${richer} of ${rows.length}`} note="one-month implied above 20-day realized, today" />
      </div>

      <div className="desk-grid">
        <Card className="desk-span-7" title="Implied against realized" subtitle="One-month at-the-money implied volatility against 20-day realized · above the line the options price more movement than the stock delivered">
          <ScatterChart
            points={points}
            xLabel="Realized volatility, 20 days"
            yLabel="Implied volatility, one month"
            format={(value) => fmtPct(value, 0, false)}
            diagonalLabel="implied = realized"
            labelled={extremes}
            palette={palette}
            onOpen={(ticker) => navigate(`/desk/company/${encodeURIComponent(ticker)}`)}
          />
        </Card>

        <Card className="desk-span-5" title="Position sizing" subtitle="Scale a position so its expected volatility meets a target (bounded between a quarter and the whole)">
          <div style={{ display: "grid", gap: 14 }}>
            <label className="desk-field">
              Company
              <select className="desk-select" value={selected.company.ticker} onChange={(event) => setFocus(event.target.value)}>
                {[...rows].sort((a, b) => a.company.ticker.localeCompare(b.company.ticker)).map((row) => <option key={row.company.cik} value={row.company.ticker}>{row.company.ticker} · {row.company.name}</option>)}
              </select>
            </label>
            <Segmented label="Volatility forecast" options={[{ value: "iv", label: "Implied, one month" }, { value: "rv", label: "Realized, 20 days" }]} value={source} onChange={setSource} />
            <label className="desk-field">
              <span>Target annual volatility: <output>{target}%</output></span>
              <input type="range" min={5} max={60} step={1} value={target} onChange={(event) => setTarget(Number(event.target.value))} />
            </label>
            <label className="desk-field">
              Reference capital, USD
              <input className="desk-input" type="number" min={0} step={1000} value={capital} onChange={(event) => setCapital(Math.max(0, Number(event.target.value) || 0))} />
            </label>
            <div className="desk-stats" style={{ gridTemplateColumns: "1fr" }}>
              <div className="desk-stat"><span>Forecast volatility</span><strong>{fmtPct(forecast, 1, false)}</strong></div>
              <div className="desk-stat"><span>Share of the full position</span><strong>{scalar === null ? "—" : fmtPct(scalar, 0, false)}</strong></div>
              <div className="desk-stat"><span>Scaled exposure</span><strong>{exposure === null ? "—" : fmtPrice(exposure)}</strong></div>
              <div className="desk-stat"><span>One expected move over a month, on that exposure</span><strong>{exposure === null || selected.move1m === null ? "—" : `±${fmtPrice(exposure * selected.move1m)}`}</strong></div>
            </div>
            <p className="desk-muted" style={{ margin: 0, fontSize: 12 }}>
              share = target ÷ forecast, kept between 25% and 100%. The expected move is a scenario size, not a maximum loss. The historical replay is in the <Link className="desk-link" to="/analytics/risk-lab">risk lab</Link>, the method in the <Link className="desk-link" to="/analytics/methodology">handbook</Link> (classic view).
            </p>
          </div>
        </Card>

        <Card className="desk-span-12" flush title="All companies with option data" subtitle="Volatilities are annualized · the expected move is the at-the-money straddle to the first expiry in the window"
          action={<Segmented label="Sort by" options={[{ value: "spread", label: "Implied − realized" }, { value: "iv1m", label: "Implied" }, { value: "rv", label: "Realized" }, { value: "slope", label: "Term slope" }, { value: "skew", label: "Skew" }, { value: "move1m", label: "Move, 1 month" }]} value={sort} onChange={setSort} />}>
          <div className="desk-table-wrap scroll">
            <table className="desk-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th className="num">Close</th>
                  <th className="num">Realized 20d</th>
                  <th className="num">Implied 1w</th>
                  <th className="num">Implied 1m</th>
                  <th className="num">Implied 3m</th>
                  <th className="num">Implied − realized</th>
                  <th className="num">Term slope</th>
                  <th className="num">Skew 25Δ</th>
                  <th className="num">Put/call OI</th>
                  <th className="num">Move 1w</th>
                  <th className="num">Move 1m</th>
                  <th>Next report</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.company.cik} onClick={() => navigate(`/desk/company/${encodeURIComponent(row.company.ticker)}`)}>
                    <td>
                      <CompanyLink company={row.company} className="company-cell">
                        <span className="desk-ticker">{row.company.ticker}</span>
                        <span>{row.company.name}</span>
                      </CompanyLink>
                    </td>
                    <td className="num">{fmtPrice(row.company.close)}</td>
                    <td className="num">{fmtPct(row.rv, 1, false)}</td>
                    <td className="num">{fmtPct(row.iv1w, 1, false)}</td>
                    <td className="num">{fmtPct(row.iv1m, 1, false)}</td>
                    <td className="num">{fmtPct(row.iv3m, 1, false)}</td>
                    <td className="num"><Delta value={row.spread} digits={1} /></td>
                    <td className="num">{pts(row.slope)}</td>
                    <td className="num">{pts(row.skew)}</td>
                    <td className="num">{fmtNum(row.putCall, 2)}</td>
                    <td className="num">{row.move1w === null ? "—" : `±${fmtPct(row.move1w, 1, false)}`}</td>
                    <td className="num">{row.move1m === null ? "—" : `±${fmtPct(row.move1m, 1, false)}`}</td>
                    <td className="desk-ink-2">{row.company.nextEarnings ? `~${fmtDate(row.company.nextEarnings, "short")}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <EvidenceNote family="options-at-release" />
      <DevNotes page="volatility" />
    </ResearchFrame>
  );
}
