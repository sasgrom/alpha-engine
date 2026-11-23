import { trpc } from "@/providers/trpc";
import type { DeskCompanyActions } from "@contracts/desk-company";
import { Card, Shimmer } from "../../components";
import { fmtDate, fmtNum, fmtPct } from "../../format";

/** "4-for-1" for a split, "1-for-8 reverse" for a reverse split; odd ratios as a factor. */
export function splitText(ratio: number): string {
  const whole = (value: number) => Math.abs(value - Math.round(value)) < 1e-9;
  if (ratio > 1 && whole(ratio)) return `${Math.round(ratio)}-for-1`;
  if (ratio > 1 && whole(ratio * 2)) return `${Math.round(ratio * 2)}-for-2`;
  if (ratio < 1 && whole(1 / ratio)) return `1-for-${Math.round(1 / ratio)} reverse`;
  return `${fmtNum(ratio, 4)} shares for 1`;
}

export function ActionsBody({ data }: { data: DeskCompanyActions }) {
  const lastDividend = data.dividends[0];
  return (
    <>
      <div className="desk-stats" style={{ gridTemplateColumns: "1fr" }}>
        <div className="desk-stat">
          <span>Dividends, last 12 months</span>
          <strong>{data.dividendsLastYear > 0 ? `$${fmtNum(data.dividendsLastYear, 2)} a share · ${fmtPct(data.dividendsLastYear / data.lastClose, 2)} of the last close` : "None"}</strong>
        </div>
        <div className="desk-stat">
          <span>Last dividend</span>
          <strong>{lastDividend ? `$${fmtNum(lastDividend.amount, lastDividend.amount < 0.1 ? 4 : 2)} · ex-date ${fmtDate(lastDividend.date, "medium")}` : "None in ten years"}</strong>
        </div>
        <div className="desk-stat">
          <span>Splits since 2000</span>
          <strong>{data.splits.length ? data.splits.map((split) => `${splitText(split.ratio)} (${fmtDate(split.date, "medium")})`).join(" · ") : "None"}</strong>
        </div>
        {data.distributions.length > 0 && (
          <div className="desk-stat">
            <span>Spin-offs and special distributions</span>
            <strong>{data.distributions.map((item) => `${fmtDate(item.date, "medium")} (price factor ${fmtNum(item.factor, 3)})`).join(" · ")}</strong>
          </div>
        )}
      </div>
      {data.dividends.length > 1 && (
        <div className="desk-table-wrap" style={{ marginTop: 10 }}>
          <table className="desk-table" style={{ fontSize: 12.5 }}>
            <thead>
              <tr><th scope="col">Ex-date</th><th scope="col" className="num">Dividend, as paid</th></tr>
            </thead>
            <tbody>
              {data.dividends.slice(0, 8).map((dividend) => (
                <tr key={dividend.date}><td>{fmtDate(dividend.date, "medium")}</td><td className="num">${fmtNum(dividend.amount, dividend.amount < 0.1 ? 4 : 2)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="desk-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
        Amounts are per share as paid on the day, before any later split. Standard prices to {fmtDate(data.pricesAsOf, "medium")}.
      </p>
    </>
  );
}

export function CompanyActions({ cik }: { cik: number }) {
  const query = trpc.desk.companyActions.useQuery({ cik }, { enabled: cik > 0, staleTime: 30 * 60_000 });
  return (
    <Card className="desk-span-4" title="Splits and dividends" subtitle="From the standard prices: every change to the share basis and every cash dividend">
      {query.isLoading ? (
        <Shimmer height={200} />
      ) : query.error ? (
        <div className="desk-empty">Splits and dividends could not be loaded: {query.error.message}</div>
      ) : !query.data ? (
        <div className="desk-empty">No standard price history is built for this company.</div>
      ) : (
        <ActionsBody data={query.data} />
      )}
    </Card>
  );
}
