import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import type { DeskCompany } from "@contracts/desk-snapshot";
import { Sparkline } from "../charts/Sparkline";
import { Card, CompanyLink, Delta, Notice, RangeBar, Shimmer } from "../components";
import { useDocumentTitle } from "../context";
import { useDeskSnapshot } from "../data";
import { DevNotes } from "../DevNotes";
import { fmtCap, fmtDate, fmtNum, fmtPct, fmtPrice } from "../format";

interface Column {
  key: string;
  label: string;
  numeric: boolean;
  value: (company: DeskCompany) => number | string | null;
  render: (company: DeskCompany) => React.ReactNode;
  csv?: (company: DeskCompany) => string;
}

const ret = (key: keyof DeskCompany["returns"], label: string, digits = 1): Column => ({
  key,
  label,
  numeric: true,
  value: (company) => company.returns[key],
  render: (company) => <Delta value={company.returns[key]} digits={digits} />,
  csv: (company) => (company.returns[key] === null ? "" : String(company.returns[key])),
});

const COLUMNS: Column[] = [
  { key: "close", label: "Price", numeric: true, value: (c) => c.close, render: (c) => fmtPrice(c.close), csv: (c) => String(c.close) },
  ret("d1", "1D", 2),
  ret("w1", "1W"),
  ret("m1", "1M"),
  ret("ytd", "YTD"),
  ret("y1", "1Y"),
  { key: "momentum12m1", label: "12−1M", numeric: true, value: (c) => c.momentum12m1 ?? null, render: (c) => <Delta value={c.momentum12m1 ?? null} digits={0} />, csv: (c) => String(c.momentum12m1 ?? "") },
  { key: "marketCap", label: "Market value", numeric: true, value: (c) => c.marketCap, render: (c) => fmtCap(c.marketCap), csv: (c) => String(c.marketCap ?? "") },
  { key: "pe", label: "P/E", numeric: true, value: (c) => c.pe, render: (c) => fmtNum(c.pe, 1), csv: (c) => String(c.pe ?? "") },
  { key: "dividendYield", label: "Yield", numeric: true, value: (c) => c.dividendYield, render: (c) => (c.dividendYield ? fmtPct(c.dividendYield, 2, false) : "—"), csv: (c) => String(c.dividendYield ?? "") },
  { key: "beta", label: "Beta", numeric: true, value: (c) => c.beta, render: (c) => fmtNum(c.beta, 2), csv: (c) => String(c.beta ?? "") },
  { key: "vol20", label: "Volatility", numeric: true, value: (c) => c.vol20, render: (c) => fmtPct(c.vol20, 0, false), csv: (c) => String(c.vol20 ?? "") },
  {
    key: "pos52",
    label: "52-week range",
    numeric: true,
    value: (c) => (c.high52 !== null && c.low52 !== null && c.high52 > c.low52 ? (c.close - c.low52) / (c.high52 - c.low52) : null),
    render: (c) => <div style={{ width: 120 }}><RangeBar low={c.low52} high={c.high52} value={c.close} /></div>,
    csv: (c) => `${c.low52 ?? ""}-${c.high52 ?? ""}`,
  },
  { key: "trend", label: "3 months", numeric: false, value: () => null, render: (c) => <Sparkline values={c.spark} width={96} height={26} /> },
  { key: "nextEarnings", label: "Next report", numeric: false, value: (c) => c.nextEarnings, render: (c) => (c.nextEarnings ? <span className="desk-ink-2">~{fmtDate(c.nextEarnings, "short")}</span> : <span className="desk-muted">—</span>), csv: (c) => c.nextEarnings ?? "" },
];

function exportCsv(rows: DeskCompany[]) {
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
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "marketCap", dir: -1 });
  const sector = params.get("sector") ?? "all";
  const researchOnly = params.get("research") === "1";
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    const column: Pick<Column, "value"> | undefined = sort.key === "ticker" ? { value: (company) => company.ticker } : COLUMNS.find((entry) => entry.key === sort.key);
    const filtered = (snapshot.data?.companies ?? []).filter(
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
  }, [snapshot.data, query, sector, researchOnly, sort]);

  if (snapshot.isLoading) return <Shimmer height={600} />;
  if (snapshot.error) return <Notice title="The market snapshot could not be loaded">{snapshot.error.message}</Notice>;
  if (!snapshot.data) return <Notice title="The screener is not ready yet">It is prepared after each market close. Please check back shortly.</Notice>;
  const data = snapshot.data;

  const header = (column: Column) => {
    const active = sort.key === column.key;
    return (
      <th key={column.key} className={column.numeric ? "num" : undefined} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
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
                {COLUMNS.map(header)}
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
                  {COLUMNS.map((column) => (
                    <td key={column.key} className={column.numeric ? "num" : undefined}>{column.render(company)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="desk-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
        Prices are daily closes adjusted for splits and dividends. Market value, P/E, yield and beta come from the latest
        Schwab fundamentals; volatility is the annualized spread of the last 20 daily returns; report dates are projected
        from each company's own calendar.
      </p>
      <DevNotes page="screener" />
    </div>
  );
}
