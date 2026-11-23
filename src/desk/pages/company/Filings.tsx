import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { trpc } from "@/providers/trpc";
import type { DeskCompanyFiling } from "@contracts/desk-company";
import { Card, Segmented, Shimmer } from "../../components";
import { DeskDialog } from "../../DeskDialog";
import { fmtDate } from "../../format";

type Kind = "all" | "reports" | "earnings" | "other";
const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "reports", label: "Annual and quarterly" },
  { value: "earnings", label: "Earnings releases" },
  { value: "other", label: "Other 8-Ks" },
];
const SHOWN = 12;

/** What an 8-K reports, by its item numbers (the common ones; an unknown item shows its number). */
const ITEMS: Record<string, string> = {
  "1.01": "Material agreement", "1.02": "Agreement ended", "1.03": "Bankruptcy", "1.05": "Cybersecurity incident",
  "2.01": "Acquisition or disposal completed", "2.02": "Results of operations", "2.03": "New debt or obligation", "2.04": "Obligation accelerated",
  "2.05": "Exit or restructuring costs", "2.06": "Impairment", "3.01": "Listing notice", "3.02": "Unregistered share sale", "3.03": "Holders' rights changed",
  "4.01": "Auditor changed", "4.02": "Earlier statements not to be relied on", "5.01": "Change in control", "5.02": "Officers and directors",
  "5.03": "Bylaws or fiscal year changed", "5.07": "Shareholder vote", "7.01": "Regulation FD disclosure", "8.01": "Other events",
};

const kindOf = (filing: DeskCompanyFiling): Exclude<Kind, "all"> => (filing.form.startsWith("10-") ? "reports" : filing.earnings ? "earnings" : "other");

/** "Quarter to Sep 26, 2026" for a report; the item names for an 8-K (the exhibits item says nothing and is left out). */
export function filingAbout(filing: DeskCompanyFiling): string {
  if (filing.form.startsWith("10-K")) return filing.period ? `Year to ${fmtDate(filing.period, "medium")}` : "Annual report";
  if (filing.form.startsWith("10-Q")) return filing.period ? `Quarter to ${fmtDate(filing.period, "medium")}` : "Quarterly report";
  const names = filing.items.filter((item) => item !== "9.01").map((item) => ITEMS[item] ?? `Item ${item}`);
  return names.length ? names.join(" · ") : filing.earnings ? "Results of operations" : "Current report";
}

/** The SEC's own copy: the main document when its name is known, else the filing's index page. */
export function secUrl(cik: number, filing: DeskCompanyFiling): string {
  const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${filing.accession.replaceAll("-", "")}`;
  return filing.primaryDoc ? `${folder}/${filing.primaryDoc}` : `${folder}/${filing.accession}-index.htm`;
}

function Reader({ cik, filing, onClose }: { cik: number; filing: DeskCompanyFiling; onClose: () => void }) {
  const [file, setFile] = useState(filing.exhibits[0]);
  const query = trpc.desk.companyDocument.useQuery({ cik, accession: filing.accession, file }, { staleTime: 60 * 60_000 });
  return (
    <DeskDialog title={`Earnings release filed ${fmtDate(filing.filed, "medium")}`} onClose={onClose}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        {filing.exhibits.length > 1 && (
          <Segmented options={filing.exhibits.map((name, index) => ({ value: name, label: `Exhibit ${index + 1}` }))} value={file} onChange={setFile} label="Exhibit" />
        )}
        <a className="desk-link" href={secUrl(cik, filing)} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>The filing at the SEC <ArrowUpRight size={12} aria-hidden="true" /></a>
      </div>
      {query.isLoading ? (
        <Shimmer height={260} />
      ) : query.error ? (
        <div className="desk-empty">The release could not be loaded: {query.error.message}</div>
      ) : !query.data ? (
        <div className="desk-empty">The cached copy of this exhibit cannot be read right now. The SEC's copy is linked above.</div>
      ) : (
        <div className="desk-document" data-document={query.data.file}>
          {query.data.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          {query.data.truncated && <p className="desk-muted">The exhibit is longer than what is shown here; the SEC's copy has all of it.</p>}
        </div>
      )}
    </DeskDialog>
  );
}

export function CompanyFilings({ cik }: { cik: number }) {
  const [kind, setKind] = useState<Kind>("all");
  const [all, setAll] = useState(false);
  const [reading, setReading] = useState<DeskCompanyFiling | null>(null);
  const query = trpc.desk.companyFilings.useQuery({ cik }, { enabled: cik > 0, staleTime: 30 * 60_000 });
  const data = query.data;
  const matching = (data?.filings ?? []).filter((filing) => kind === "all" || kindOf(filing) === kind);
  const rows = all ? matching : matching.slice(0, SHOWN);
  return (
    <Card
      className="desk-span-12"
      title="Filings"
      subtitle={data
        ? `Annual, quarterly and current reports of the last five years · the engine's release calendar, filings to ${fmtDate(data.asOf, "medium")}`
        : "Annual, quarterly and current reports"}
      action={data ? <Segmented options={KINDS} value={kind} onChange={(next) => { setKind(next); setAll(false); }} label="Kind of filing" /> : undefined}
    >
      {query.isLoading ? (
        <Shimmer height={180} />
      ) : query.error ? (
        <div className="desk-empty">The filings could not be loaded: {query.error.message}</div>
      ) : !data ? (
        <div className="desk-empty">The release calendar holds no filings for this company.</div>
      ) : !rows.length ? (
        <div className="desk-empty">No filings of this kind in the last five years.</div>
      ) : (
        <>
          <div className="desk-table-wrap">
            <table className="desk-table" style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th scope="col" style={{ position: "static" }}>Filed</th>
                  <th scope="col" style={{ position: "static" }}>Form</th>
                  <th scope="col" style={{ position: "static" }}>About</th>
                  <th scope="col" style={{ position: "static" }} aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {rows.map((filing) => (
                  <tr key={filing.accession} style={{ cursor: "default" }}>
                    <td title={filing.acceptedEt ? `Accepted by the SEC ${filing.acceptedEt.slice(11, 16)} Eastern time` : undefined} style={{ whiteSpace: "nowrap" }}>{fmtDate(filing.filed, "medium")}</td>
                    <td>{filing.form}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      {filingAbout(filing)}
                      {filing.earnings && <span className="desk-badge accent" style={{ marginLeft: 6, height: 18 }}>Earnings</span>}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {filing.exhibits.length > 0 && (
                        <button type="button" className="desk-link" style={{ border: "none", background: "transparent", padding: 0, marginRight: 14, font: "inherit", cursor: "pointer" }} onClick={() => setReading(filing)}>Read the release</button>
                      )}
                      <a className="desk-link" href={secUrl(cik, filing)} target="_blank" rel="noreferrer" aria-label={`${filing.form} of ${fmtDate(filing.filed, "medium")} at the SEC`}>SEC <ArrowUpRight size={12} aria-hidden="true" /></a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {matching.length > SHOWN && (
            <button type="button" className="desk-link" style={{ border: "none", background: "transparent", padding: 0, marginTop: 8, font: "inherit", fontSize: 12.5, cursor: "pointer" }} onClick={() => setAll((open) => !open)}>
              {all ? `Show the latest ${SHOWN}` : `Show all ${matching.length}`}
            </button>
          )}
        </>
      )}
      {reading && <Reader cik={cik} filing={reading} onClose={() => setReading(null)} />}
    </Card>
  );
}
