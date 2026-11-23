import { useState } from "react";
import { trpc } from "@/providers/trpc";
import type { DeskCompanyInsiders, DeskInsiderQuarter } from "@contracts/desk-company";
import { PeriodBars } from "../../charts/PeriodBars";
import { Card, Shimmer } from "../../components";
import { useDesk } from "../../context";
import { fmtCap, fmtCompact, fmtDate, fmtPct, personName } from "../../format";

const CODES: Record<string, string> = {
  P: "Purchase",
  S: "Sale",
  A: "Grant or award",
  M: "Option exercise",
  X: "Option exercise",
  F: "Tax withholding",
  G: "Gift",
  D: "Returned to issuer",
  C: "Conversion",
  J: "Other",
};
const SHOWN = 10;

const dollars = (value: number) => `${value < 0 ? "−" : ""}$${fmtCompact(Math.abs(value))}`;
const people = (count: number) => `${count} insider${count === 1 ? "" : "s"}`;

/** "In the 12 months to Nov 13, 2026: 1 insider bought $95.0K on the open market; 3 insiders sold $12.3M, 80% of it under 10b5-1 plans." */
export function insiderYear(data: DeskCompanyInsiders): string {
  const { bought, sold, buyers, sellers, soldUnderPlan } = data.year;
  const buy = buyers ? `${people(buyers)} bought ${dollars(bought)} on the open market` : "no insider bought on the open market";
  const plan = sold > 0 && soldUnderPlan > 0 ? `, ${fmtPct(soldUnderPlan / sold, 0, false)} of it under 10b5-1 plans` : "";
  const sell = sellers ? `${people(sellers)} sold ${dollars(sold)}${plan}` : "none sold";
  return `In the 12 months to ${fmtDate(data.asOf, "medium")}: ${buy}; ${sell}.`;
}

function quarterBar(row: DeskInsiderQuarter) {
  const label = `Q${Math.ceil(Number(row.quarter.slice(5, 7)) / 3)} ${row.quarter.slice(2, 4)}`;
  return {
    key: row.quarter, label, value: row.bought || row.sold ? row.bought - row.sold : null,
    title: `Calendar quarter to ${fmtDate(row.quarter, "medium")} · bought ${dollars(row.bought)} by ${row.buyers} · sold ${dollars(row.sold)} by ${row.sellers}`,
  };
}

export function CompanyInsiders({ cik }: { cik: number }) {
  const { palette } = useDesk();
  const [all, setAll] = useState(false);
  const query = trpc.desk.companyInsiders.useQuery({ cik }, { enabled: cik > 0, staleTime: 30 * 60_000 });
  const data = query.data;
  const rows = data ? (all ? data.trades : data.trades.slice(0, SHOWN)) : [];
  return (
    <Card
      className="desk-span-7"
      title="Insider transactions"
      subtitle={data
        ? `Forms 4 and 5 of officers, directors and large holders · insider standard ${data.version} · filings to ${fmtDate(data.asOf, "medium")}`
        : "Forms 4 and 5 of officers, directors and large holders"}
    >
      {query.isLoading ? (
        <Shimmer height={160} />
      ) : query.error ? (
        <div className="desk-empty">The insider transactions could not be loaded: {query.error.message}</div>
      ) : !data ? (
        <div className="desk-empty">No insider filings are in the standard for this company.</div>
      ) : (
        <>
          <p className="desk-ink-2" style={{ fontSize: 12.5, margin: "0 0 10px" }}>{insiderYear(data)}</p>
          {data.quarters.some((row) => row.bought || row.sold) && (
            <div style={{ marginBottom: 12 }} data-insider-chart>
              <div className="desk-muted" style={{ fontSize: 12, marginBottom: 2 }}>Open-market purchases less sales, by calendar quarter</div>
              <PeriodBars bars={data.quarters.map(quarterBar)} format={dollars} yearSteps={4} name="Insider open-market purchases less sales, by calendar quarter" height={120} palette={palette} />
            </div>
          )}
          {rows.length ? (
            <div className="desk-table-wrap">
              <table className="desk-table" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th scope="col" style={{ position: "static" }}>Date</th>
                    <th scope="col" style={{ position: "static" }}>Insider</th>
                    <th scope="col" style={{ position: "static" }}>Transaction</th>
                    <th scope="col" className="num" style={{ position: "static" }}>Shares</th>
                    <th scope="col" className="num" style={{ position: "static" }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((trade, index) => (
                    <tr key={`${trade.date}|${trade.filed}|${trade.owner}|${trade.code}|${index}`} style={{ cursor: "default" }}>
                      <td title={`Reported ${fmtDate(trade.filed, "medium")}`}>{fmtDate(trade.date, "medium")}</td>
                      <td style={{ maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {personName(trade.owner)}
                        {trade.more > 0 && <span className="desk-muted"> and {trade.more} reporting with them</span>}
                        {trade.role && <span className="desk-muted"> · {trade.role}</span>}
                      </td>
                      <td>
                        {CODES[trade.code] ?? `Code ${trade.code}`}
                        {trade.plan && <span className="desk-badge" style={{ marginLeft: 6, height: 18 }} title="Reported under a Rule 10b5-1 trading plan">Plan</span>}
                      </td>
                      <td className="num">{trade.shares === null ? "—" : fmtCompact(trade.shares)}</td>
                      <td className="num" title={trade.valueUsd === null && trade.price !== null ? "The filed price is out of line with the market price of that day; no value is shown" : undefined}>
                        {trade.valueUsd === null ? "—" : fmtCap(trade.valueUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="desk-empty">No stock transactions were reported in the last three years.</div>
          )}
          {data.trades.length > SHOWN && (
            <button type="button" className="desk-link" style={{ border: "none", background: "transparent", padding: 0, marginTop: 8, font: "inherit", fontSize: 12.5, cursor: "pointer" }} onClick={() => setAll((open) => !open)}>
              {all ? `Show the latest ${SHOWN}` : data.tradeCount > data.trades.length ? `Show the latest ${data.trades.length} of ${data.tradeCount}` : `Show all ${data.trades.length}`}
            </button>
          )}
          <p className="desk-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
            Stock transactions of the last three years, each trade once; amended reports and option lines are left out. The sums count open-market purchases and sales only.
          </p>
        </>
      )}
    </Card>
  );
}
