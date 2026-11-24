import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import type { DeskScreenCompany } from "@contracts/desk-company";
import type { DeskCompany } from "@contracts/desk-snapshot";
import { trpc } from "@/providers/trpc";
import { Sparkline } from "../charts/Sparkline";
import { Card, CompanyLink, Delta, Notice, RangeBar, Segmented, Shimmer } from "../components";
import { useDocumentTitle } from "../context";
import { useDeskSnapshot } from "../data";
import { DevNotes } from "../DevNotes";
import { fmtCap, fmtDate, fmtNum, fmtPct, fmtPrice } from "../format";

type View = "performance" | "fundamentals";
/** A company of the market snapshot with its row of the fundamentals file (null until that file is read, or without one). */
type Row = DeskCompany & { screen: DeskScreenCompany | null };

interface Column {
  key: string;
  label: string;
  /** What the column is, for the header's hover text. */
  hint?: string;
  views: View[];
  numeric: boolean;
  value: (company: Row) => number | string | null;
  render: (company: Row) => React.ReactNode;
  csv?: (company: Row) => string;
}

const BOTH: View[] = ["performance", "fundamentals"];
const ret = (key: keyof DeskCompany["returns"], label: string, digits = 1): Column => ({
  key,
  label,
  views: ["performance"],
  numeric: true,
  value: (company) => company.returns[key],
  render: (company) => <Delta value={company.returns[key]} digits={digits} />,
  csv: (company) => (company.returns[key] === null ? "" : String(company.returns[key])),
});

// Per-share figures come from the standard fundamentals; where they have none for a company (several share classes,
// a changed registrant), Schwab's figure stands in and is shown grey.
const FROM_SCHWAB = "Schwab's figure: the filings data has no per-share figure for this company";
const ownEps = (row: Row): number | null => row.screen?.epsDiluted ?? null;
// Schwab divides the traded class's price by another class's earnings for a few companies (Berkshire's B share over
// the A share's earnings: a "P/E" of 0.01). A P/E below 1 is no P/E, and neither figure stands in then.
const schwabEps = (row: Row): number | null => (row.pe !== null && row.pe < 1 ? null : row.epsTtm);
const schwabPe = (row: Row): number | null => (row.pe !== null && row.pe < 1 ? null : row.pe);
const eps = (row: Row): number | null => ownEps(row) ?? schwabEps(row);
const pe = (row: Row): number | null => {
  const own = ownEps(row);
  if (own !== null) return own > 0 && row.close > 0 ? row.close / own : null;
  return schwabPe(row);
};
const ratio = (part: number | null | undefined, whole: number | null | undefined): number | null => (part === null || part === undefined || !whole || whole <= 0 ? null : part / whole);
const growth = (row: Row): number | null => { const now = ratio(row.screen?.revenue, row.screen?.revenueYearAgo); return now === null ? null : now - 1; };
const netMargin = (row: Row): number | null => ratio(row.screen?.netIncome, row.screen?.revenue);
const fcfMargin = (row: Row): number | null => ratio(row.screen?.freeCashFlow, row.screen?.revenue);
const plain = (value: number | null) => (value === null ? "" : String(Math.round(value * 1e6) / 1e6));
const none = <span className="desk-muted">—</span>;
const share = (value: number | null) => (value === null ? none : <span className={value < 0 ? "desk-down" : undefined}>{fmtPct(value, 1, false)}</span>);
const quarterLabel = (end: string) => new Date(`${end}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

const COLUMNS: Column[] = [
  { key: "close", label: "Price", views: BOTH, numeric: true, value: (c) => c.close, render: (c) => fmtPrice(c.close), csv: (c) => String(c.close) },
  ret("d1", "1D", 2),
  ret("w1", "1W"),
  ret("m1", "1M"),
  ret("ytd", "YTD"),
  ret("y1", "1Y"),
  { key: "momentum12m1", label: "12−1M", hint: "Return from a year ago to a month ago", views: ["performance"], numeric: true, value: (c) => c.momentum12m1 ?? null, render: (c) => <Delta value={c.momentum12m1 ?? null} digits={0} />, csv: (c) => String(c.momentum12m1 ?? "") },
  { key: "marketCap", label: "Market value", views: BOTH, numeric: true, value: (c) => c.marketCap, render: (c) => fmtCap(c.marketCap), csv: (c) => String(c.marketCap ?? "") },
  {
    key: "pe", label: "P/E", hint: "Price / diluted earnings per share of the last four quarters", views: ["fundamentals"], numeric: true, value: pe,
    render: (c) => {
      const own = ownEps(c);
      if (own !== null) return own > 0 ? fmtNum(pe(c), 1) : <span className="desk-muted" title="A loss over the last four quarters">—</span>;
      return schwabPe(c) === null ? none : <span className="desk-muted" title={FROM_SCHWAB}>{fmtNum(schwabPe(c), 1)}</span>;
    },
    csv: (c) => plain(pe(c)),
  },
  {
    key: "eps", label: "EPS", hint: "Diluted earnings per share of the last four reported quarters, on today's share basis", views: ["fundamentals"], numeric: true, value: eps,
    render: (c) => {
      const own = ownEps(c);
      if (own === null) return schwabEps(c) === null ? none : <span className="desk-muted" title={FROM_SCHWAB}>{fmtNum(schwabEps(c), 2)}</span>;
      return <span className={own < 0 ? "desk-down" : undefined} title={c.screen?.epsHow === "last_shares" ? "Net income of the four quarters / the last quarter's diluted shares: the filings data lacks one quarter's share count" : undefined}>{fmtNum(own, 2)}</span>;
    },
    csv: (c) => plain(eps(c)),
  },
  { key: "revenue", label: "Revenue", hint: "Revenue of the last four reported quarters", views: ["fundamentals"], numeric: true, value: (c) => c.screen?.revenue ?? null, render: (c) => fmtCap(c.screen?.revenue), csv: (c) => plain(c.screen?.revenue ?? null) },
  { key: "revenueGrowth", label: "Growth", hint: "Revenue of the last four quarters against the four before them", views: ["fundamentals"], numeric: true, value: growth, render: (c) => <Delta value={growth(c)} digits={1} />, csv: (c) => plain(growth(c)) },
  { key: "netMargin", label: "Net margin", hint: "Net income to common stockholders / revenue, last four quarters", views: ["fundamentals"], numeric: true, value: netMargin, render: (c) => share(netMargin(c)), csv: (c) => plain(netMargin(c)) },
  { key: "fcfMargin", label: "FCF margin", hint: "Free cash flow (cash from operations less capital spending) / revenue, last four quarters", views: ["fundamentals"], numeric: true, value: fcfMargin, render: (c) => share(fcfMargin(c)), csv: (c) => plain(fcfMargin(c)) },
  { key: "dividendYield", label: "Yield", views: ["fundamentals"], numeric: true, value: (c) => c.dividendYield, render: (c) => (c.dividendYield ? fmtPct(c.dividendYield, 2, false) : "—"), csv: (c) => String(c.dividendYield ?? "") },
  { key: "dollarVolume", label: "Volume", hint: "Mean dollars traded a day over the last three months", views: ["fundamentals"], numeric: true, value: (c) => c.screen?.dollarVolume ?? null, render: (c) => fmtCap(c.screen?.dollarVolume), csv: (c) => plain(c.screen?.dollarVolume ?? null) },
  { key: "beta", label: "Beta", views: ["performance"], numeric: true, value: (c) => c.beta, render: (c) => fmtNum(c.beta, 2), csv: (c) => String(c.beta ?? "") },
  { key: "vol20", label: "Volatility", hint: "Annualized spread of the last 20 daily returns", views: ["performance"], numeric: true, value: (c) => c.vol20, render: (c) => fmtPct(c.vol20, 0, false), csv: (c) => String(c.vol20 ?? "") },
  {
    key: "pos52",
    label: "52-week range",
    views: ["performance"],
    numeric: true,
    value: (c) => (c.high52 !== null && c.low52 !== null && c.high52 > c.low52 ? (c.close - c.low52) / (c.high52 - c.low52) : null),
    render: (c) => <div style={{ width: 120 }}><RangeBar low={c.low52} high={c.high52} value={c.close} /></div>,
    csv: (c) => `${c.low52 ?? ""}-${c.high52 ?? ""}`,
  },
  { key: "trend", label: "3 months", views: ["performance"], numeric: false, value: () => null, render: (c) => <Sparkline values={c.spark} width={96} height={26} /> },
  { key: "reported", label: "Quarter", hint: "The last quarter the company has reported: the four quarters end there", views: ["fundamentals"], numeric: false, value: (c) => c.screen?.periodEnd ?? null, render: (c) => (c.screen ? <span className="desk-ink-2">{quarterLabel(c.screen.periodEnd)}</span> : none), csv: (c) => c.screen?.periodEnd ?? "" },
  { key: "nextEarnings", label: "Next report", views: ["performance"], numeric: false, value: (c) => c.nextEarnings, render: (c) => (c.nextEarnings ? <span className="desk-ink-2">~{fmtDate(c.nextEarnings, "short")}</span> : none), csv: (c) => c.nextEarnings ?? "" },
];

function exportCsv(rows: Row[]) {
  const header = ["ticker", "name", "sector", ...COLUMNS.filter((column) => column.csv).map((column) => column.key)];
  const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [header.join(","), ...rows.map((row) => [row.ticker, row.name, row.sector, ...COLUMNS.filter((column) => column.csv).map((column) => column.csv!(row))].map(quote).join(","))];
  const url = URL.createObjectURL(new Blob([`${lines.join("\n")}\n`], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "alpha-engine-screener.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Screener() {
  useDocumentTitle("Screener");
  const navigate = useNavigate();
  const snapshot = useDeskSnapshot();
  const screen = trpc.desk.screen.useQuery(undefined, { staleTime: 30 * 60_000, refetchOnWindowFocus: false });
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "marketCap", dir: -1 });
  const sector = params.get("sector") ?? "all";
  const researchOnly = params.get("research") === "1";
  const view: View = params.get("view") === "fundamentals" ? "fundamentals" : "performance";
  const columns = useMemo(() => COLUMNS.filter((column) => column.views.includes(view)), [view]);
  // a sort by a column the other view does not show falls back to the market value
  useEffect(() => {
    if (sort.key !== "ticker" && !columns.some((column) => column.key === sort.key)) setSort({ key: "marketCap", dir: -1 });
  }, [columns, sort.key]);
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    const column: Pick<Column, "value"> | undefined = sort.key === "ticker" ? { value: (company) => company.ticker } : COLUMNS.find((entry) => entry.key === sort.key);
    const byCik = new Map((screen.data?.companies ?? []).map((entry) => [entry.cik, entry]));
    const filtered = (snapshot.data?.companies ?? []).map((company): Row => ({ ...company, screen: byCik.get(company.cik) ?? null })).filter(
      (company) =>
        (sector === "all" || company.sector === sector) &&
        (!researchOnly || company.research) &&
        (!q || company.ticker.toUpperCase().includes(q) || company.name.toUpperCase().includes(q)),
    );
    if (!column) return filtered;
    return [...filtered].sort((a, b) => {
      const x = column.value(a);
      const y = column.value(b);
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [snapshot.data, screen.data, query, sector, researchOnly, sort]);

  if (snapshot.isLoading) return <Shimmer height={600} />;
  if (snapshot.error) return <Notice title="The market snapshot could not be loaded">{snapshot.error.message}</Notice>;
  if (!snapshot.data) return <Notice title="The screener is not ready yet">It is prepared after each market close. Please check back shortly.</Notice>;
  const data = snapshot.data;

  const header = (column: Column) => {
    const active = sort.key === column.key;
    return (
      <th key={column.key} className={column.numeric ? "num" : undefined} title={column.hint} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
        {column.key === "trend" ? (
          column.label
        ) : (
          <button type="button" onClick={() => setSort(active ? { key: column.key, dir: sort.dir === 1 ? -1 : 1 } : { key: column.key, dir: column.numeric ? -1 : 1 })}>
            {column.label} {active && (sort.dir === 1 ? <ArrowUp size={12} style={{ verticalAlign: -1 }} /> : <ArrowDown size={12} style={{ verticalAlign: -1 }} />)}
          </button>
        )}
      </th>
    );
  };

  return (
    <div>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">S&amp;P 500 · close of {fmtDate(data.session, "long")}</span>
          <h1>Screener</h1>
          <p className="desk-lede">Filter and sort the whole index. Select a column to sort by it, a row to open the company.</p>
        </div>
      </div>
      <div className="desk-controls">
        <Segmented<View> label="Columns" options={[{ value: "performance", label: "Performance" }, { value: "fundamentals", label: "Fundamentals" }]} value={view} onChange={(next) => setParam("view", next === "performance" ? null : next)} />
        <input className="desk-input" type="search" placeholder="Filter by ticker or name" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Filter by ticker or name" style={{ width: 260 }} />
        <select className="desk-select" aria-label="Sector" value={sector} onChange={(event) => setParam("sector", event.target.value === "all" ? null : event.target.value)}>
          <option value="all">All sectors</option>
          {data.sectors.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
        </select>
        <label className="desk-check">
          <input type="checkbox" checked={researchOnly} onChange={(event) => setParam("research", event.target.checked ? "1" : null)} />
          Research companies only
        </label>
        <span className="desk-muted" style={{ marginLeft: "auto", fontSize: 13 }}>
          {rows.length} of {data.companies.length} companies
        </span>
        <button type="button" className="desk-button" onClick={() => exportCsv(rows)}>
          <Download size={15} aria-hidden="true" /> Export CSV
        </button>
      </div>
      <Card flush>
        <div className="desk-table-wrap scroll">
          <table className="desk-table">
            <thead>
              <tr>
                <th>
                  <button type="button" onClick={() => setSort(sort.key === "ticker" ? { key: "ticker", dir: sort.dir === 1 ? -1 : 1 } : { key: "ticker", dir: 1 })}>Company</button>
                </th>
                <th>Sector</th>
                {columns.map(header)}
              </tr>
            </thead>
            <tbody>
              {rows.map((company) => (
                <tr key={company.cik} onClick={() => navigate(`/desk/company/${encodeURIComponent(company.ticker)}`)}>
                  <td>
                    <CompanyLink company={company} className="company-cell">
                      <span className="desk-ticker">{company.ticker}{company.research && <span className="desk-badge accent" style={{ marginLeft: 6, height: 18, fontSize: 10.5 }}>Research</span>}</span>
                      <span>{company.name}</span>
                    </CompanyLink>
                  </td>
                  <td className="desk-ink-2" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{company.sector}</td>
                  {columns.map((column) => (
                    <td key={column.key} className={column.numeric ? "num" : undefined}>{column.render(company)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="desk-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
        Prices are daily closes adjusted for splits and dividends; volatility is the annualized spread of the last 20
        daily returns; report dates are projected from each company's own calendar. Market value, yield and beta are
        Schwab's figures.
      </p>
      <p className="desk-muted" style={{ fontSize: 12.5, marginTop: 6 }}>
        Fundamentals are read from the companies' own filings (standard fundamentals{screen.data ? ` ${screen.data.standard}` : ""}): the four quarters
        ending at the quarter named in the row, in the latest filed figures. Earnings per share are diluted and on today's
        share basis, and P/E is the price over them. A grey figure is Schwab's, where the filings data has no per-share
        figure for the company. Volume is the mean dollars traded a day over three months{screen.data?.pricesAsOf ? `, to ${fmtDate(screen.data.pricesAsOf, "long")}` : ""}.
        {screen.error ? " The fundamentals file could not be read, so those columns are empty." : ""}
      </p>
      <DevNotes page="screener" />
    </div>
  );
}
