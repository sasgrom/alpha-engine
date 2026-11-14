import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { DESK_PERIODS, type DeskPeriod } from "@contracts/desk-snapshot";
import { DivergingLegend, MarketMap } from "../charts/MarketMap";
import { useWidth } from "../charts/scale";
import { Card, CompanyLink, Delta, Notice, Segmented, Shimmer } from "../components";
import { MarketIntradayPanel } from "../components/IntradayPanels";
import { useDesk, useDocumentTitle } from "../context";
import { periodLabel, useDeskSnapshot } from "../data";
import { DevNotes } from "../DevNotes";
import { fmtCap, fmtDate, fmtPrice } from "../format";

const PERIOD_OPTIONS = DESK_PERIODS.map((period) => ({ value: period, label: periodLabel(period) }));

export default function Markets() {
  useDocumentTitle("Markets");
  const navigate = useNavigate();
  const { palette } = useDesk();
  const snapshot = useDeskSnapshot();
  const [period, setPeriod] = useState<DeskPeriod>("d1");
  const [sizeBy, setSizeBy] = useState<"cap" | "equal">("cap");
  const [view, setView] = useState<"map" | "table">("map");
  const [sector, setSector] = useState("all");
  const [frame, width] = useWidth<HTMLDivElement>();
  const data = snapshot.data;
  const companies = useMemo(() => (data?.companies ?? []).filter((company) => sector === "all" || company.sector === sector), [data, sector]);
  const tableRows = useMemo(() => [...companies].sort((a, b) => (b.returns[period] ?? -Infinity) - (a.returns[period] ?? -Infinity)), [companies, period]);

  if (snapshot.isLoading) return <Shimmer height={640} />;
  if (snapshot.error) return <Notice title="The market snapshot could not be loaded">{snapshot.error.message}</Notice>;
  if (!data) return <Notice title="The market map is not ready yet">It is prepared after each market close. Please check back shortly.</Notice>;

  const height = Math.round(Math.max(420, Math.min(760, (width || 1200) * 0.56)));
  const sectors = data.sectors.filter((row) => row.name !== "Other");

  return (
    <div>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">S&amp;P 500 · close of {fmtDate(data.session, "long")}</span>
          <h1>Market map</h1>
          <p className="desk-lede">Every company in the index, grouped by sector, sized by market value and colored by its return. Hover a tile for the details, select it to open the company.</p>
        </div>
      </div>

      <div className="desk-controls">
        <Segmented label="Return period" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
        <Segmented label="Tile size" options={[{ value: "cap", label: "Market value" }, { value: "equal", label: "Equal" }]} value={sizeBy} onChange={setSizeBy} />
        <select className="desk-select" aria-label="Sector" value={sector} onChange={(event) => setSector(event.target.value)}>
          <option value="all">All sectors</option>
          {data.sectors.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
        </select>
        <Segmented label="View" options={[{ value: "map", label: "Map" }, { value: "table", label: "Table" }]} value={view} onChange={setView} />
        <span style={{ marginLeft: "auto" }}><DivergingLegend period={period} palette={palette} /></span>
      </div>

      <MarketIntradayPanel />

      <div ref={frame}>
        {view === "map" ? (
          <MarketMap companies={companies} period={period} sizeBy={sizeBy} height={height} palette={palette} onOpen={(company) => navigate(`/desk/company/${encodeURIComponent(company.ticker)}`)} />
        ) : (
          <Card flush>
            <div className="desk-table-wrap scroll">
              <table className="desk-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Sector</th>
                    <th className="num">Close</th>
                    <th className="num">{periodLabel(period)}</th>
                    <th className="num">Market value</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((company) => (
                    <tr key={company.cik} onClick={() => navigate(`/desk/company/${encodeURIComponent(company.ticker)}`)}>
                      <td>
                        <CompanyLink company={company} className="company-cell">
                          <span className="desk-ticker">{company.ticker}</span>
                          <span>{company.name}</span>
                        </CompanyLink>
                      </td>
                      <td className="desk-ink-2">{company.sector}</td>
                      <td className="num">{fmtPrice(company.close)}</td>
                      <td className="num"><Delta value={company.returns[period]} digits={2} /></td>
                      <td className="num">{fmtCap(company.marketCap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <h2 className="desk-section-title">Sectors across periods</h2>
      <Card flush>
        <div className="desk-table-wrap">
          <table className="desk-table">
            <thead>
              <tr>
                <th>Sector</th>
                <th className="num">Companies</th>
                <th className="num">Market value</th>
                {DESK_PERIODS.map((key) => <th key={key} className="num">{periodLabel(key)}</th>)}
                <th className="num">Up / down today</th>
              </tr>
            </thead>
            <tbody>
              {sectors.map((row) => (
                <tr key={row.name} onClick={() => navigate(`/desk/screener?sector=${encodeURIComponent(row.name)}`)}>
                  <td style={{ fontWeight: 560 }}>{row.name}</td>
                  <td className="num">{row.companies}</td>
                  <td className="num">{fmtCap(row.marketCap)}</td>
                  {DESK_PERIODS.map((key) => <td key={key} className="num"><Delta value={row.returns[key]} digits={key === "d1" || key === "w1" ? 2 : 1} /></td>)}
                  <td className="num desk-ink-2">{row.advancers} / {row.decliners}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="desk-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
        Sector returns are weighted by market value. Returns use stored daily closes, adjusted for splits and dividends; the
        one-week to one-year columns compare with the last close on or before the same calendar date.
      </p>
      <DevNotes page="markets" />
    </div>
  );
}
