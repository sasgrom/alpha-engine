import { trpc } from "@/providers/trpc";
import type { DeskCompanyHolders, DeskHoldersQuarter } from "@contracts/desk-company";
import { Shimmer } from "../../components";
import { daysBetween, entityName, fmtCap, fmtCompact, fmtDate, fmtPct, localToday } from "../../format";

function Stat({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="desk-stat" title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/** "+184.9M" / "−12.0M": shares bought less shares sold over the quarter. */
export function netShares(quarter: DeskHoldersQuarter): string | null {
  if (quarter.sharesBought === null || quarter.sharesSold === null) return null;
  const net = quarter.sharesBought - quarter.sharesSold;
  return `${net > 0 ? "+" : ""}${fmtCompact(net)}`;
}

/** A quarter's 13F reports are due 45 days after it ends: past that for the next quarter, the newest quarter shown is not the latest filed. */
export function holdersBehind(data: DeskCompanyHolders, today: string): boolean {
  const last = data.quarters.at(-1);
  return !!last && daysBetween(last.period, today) > 92 + 45 + 7;
}

/**
 * Fund holdings from the 13F standard: the funds whose reports are read, as known a set time after the quarter. The
 * largest holders come from the same fund books through the Flows files.
 */
export function CompanyHolders({ cik }: { cik: number }) {
  const query = trpc.desk.companyHolders.useQuery({ cik }, { enabled: cik > 0, staleTime: 30 * 60_000 });
  const flows = trpc.desk.flowsCompany.useQuery({ cik }, { enabled: cik > 0, staleTime: 30 * 60_000 });
  if (query.isLoading) {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <Shimmer height={16} />
        <Shimmer height={16} width="70%" />
      </div>
    );
  }
  if (query.error) return <div className="desk-empty" style={{ padding: "6px 0" }}>The fund holdings could not be loaded: {query.error.message}</div>;
  const data = query.data;
  const last = data?.quarters.at(-1);
  if (!data || !last) return <div className="desk-empty" style={{ padding: "6px 0" }}>The funds we read report no holding of this company.</div>;
  const net = netShares(last);
  const top = (flows.data?.holders ?? []).slice(0, 3);
  return (
    <>
      <div className="desk-stats" style={{ gridTemplateColumns: "1fr" }}>
        <Stat label={`Funds holding (${fmtDate(last.period, "medium")})`} value={`${last.holders.toLocaleString("en-US")} of ${last.fundsFiled.toLocaleString("en-US")}`} title={`Of the ${last.fundsFiled} large funds whose report for the quarter was on file by ${fmtDate(last.knownAt, "medium")}`} />
        <Stat label="Share of the stock they hold" value={last.shareOfStock === null ? "—" : fmtPct(last.shareOfStock, 1, false)} title="Shares held by these funds ÷ shares outstanding, both on today's share basis" />
        <Stat label="Value held" value={fmtCap(last.valueUsd)} />
        {last.entries !== null && last.exits !== null && (
          <Stat label="New holders / full exits in the quarter" value={`${last.entries} / ${last.exits}`} title={last.continuing !== null ? `Among the ${last.continuing} funds that reported this quarter and the one before` : undefined} />
        )}
        {net !== null && <Stat label="Shares bought less sold in the quarter" value={net} title="On today's share basis" />}
        {last.top10Share !== null && <Stat label="Held by the ten largest of them" value={fmtPct(last.top10Share, 1, false)} />}
        {top.map((holder) => <Stat key={holder.cik} label={entityName(holder.name)} value={fmtCap(holder.usd)} />)}
      </div>
      <p className="desk-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
        13F standard {data.version}, as known on {fmtDate(last.knownAt, "medium")}.
        {holdersBehind(data, localToday()) ? " The reports for the quarter after it are not collected yet." : ""}
      </p>
    </>
  );
}
