import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import type { DeskCompany, DeskSnapshot } from "@contracts/desk-snapshot";
import { CompanyLink, Notice, Segmented, Shimmer } from "../../components";
import { useDocumentTitle } from "../../context";
import { earningsRadar, useDeskSnapshot } from "../../data";
import { DevNotes } from "../../DevNotes";
import { SIGNAL_FAMILIES, type EvidenceStatus } from "../../evidence";
import { fmtNum, fmtPct } from "../../format";
import { EvidenceChip, ResearchFrame } from "../../ResearchParts";

type Filter = "all" | "candidate" | "risk" | "none" | "open";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "candidate", label: "Candidates" },
  { value: "risk", label: "Risk" },
  { value: "none", label: "No evidence" },
  { value: "open", label: "Open" },
];

function matches(status: EvidenceStatus, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "open") return status === "invalid" || status === "untested";
  return status === filter;
}

interface Reading {
  company: DeskCompany;
  text: string;
}

function ivSpread(company: DeskCompany): number | null {
  const month = company.options?.buckets.find((bucket) => bucket.bucket === "8-30D");
  return month?.atmIv !== null && month?.atmIv !== undefined && company.options?.rv20 !== null && company.options?.rv20 !== undefined ? month.atmIv - company.options.rv20 : null;
}

/** The strongest current readings of a family, where the snapshot holds one. Descriptive, not a forecast. */
function liveReadings(snapshot: DeskSnapshot): Record<string, { caption: string; rows: Reading[] }> {
  const companies = snapshot.companies;
  const top = <T,>(rows: T[], count: number) => rows.slice(0, count);
  const reported = earningsRadar(snapshot, 7, 0).reported.filter((company) => company.lastEarningsReaction !== null && company.sector !== "Financials");
  const spreads = companies.map((company) => ({ company, spread: ivSpread(company) })).filter((row): row is { company: DeskCompany; spread: number } => row.spread !== null).sort((a, b) => b.spread - a.spread);
  return {
    reaction: {
      caption: "Largest reactions of the last 7 days (banks and insurers left out)",
      rows: top([...reported].sort((a, b) => Math.abs(b.lastEarningsReaction!) - Math.abs(a.lastEarningsReaction!)), 5).map((company) => ({ company, text: fmtPct(company.lastEarningsReaction, 1) })),
    },
    "iv-rv": {
      caption: "One-month implied minus 20-day realized volatility: richest and cheapest",
      rows: [...top(spreads, 3), ...spreads.slice(-3)].map((row) => ({ company: row.company, text: `${fmtPct(row.spread, 1)} pts`.replace("%", "") })),
    },
    insiders: {
      caption: "Open-market purchases in the last 90 days",
      rows: companies.filter((company) => (company.insiders?.buys ?? 0) > 0).sort((a, b) => (b.insiders!.buyUsd ?? 0) - (a.insiders!.buyUsd ?? 0)).slice(0, 6).map((company) => ({ company, text: `${company.insiders!.buyers} buyer${company.insiders!.buyers === 1 ? "" : "s"}` })),
    },
    momentum: {
      caption: "Highest 12-month return skipping the last month",
      rows: top(companies.filter((company) => company.momentum12m1 !== null && company.momentum12m1 !== undefined).sort((a, b) => b.momentum12m1! - a.momentum12m1!), 5).map((company) => ({ company, text: fmtPct(company.momentum12m1, 0) })),
    },
    "short-interest": {
      caption: "Most days to cover",
      rows: top(companies.filter((company) => company.shortInterest?.daysToCover).sort((a, b) => b.shortInterest!.daysToCover! - a.shortInterest!.daysToCover!), 5).map((company) => ({ company, text: `${fmtNum(company.shortInterest!.daysToCover, 1)} d` })),
    },
  };
}

export default function Signals() {
  useDocumentTitle("Signals");
  const snapshot = useDeskSnapshot();
  const [filter, setFilter] = useState<Filter>("all");
  const readings = useMemo(() => (snapshot.data ? liveReadings(snapshot.data) : {}), [snapshot.data]);
  const families = SIGNAL_FAMILIES.filter((family) => matches(family.status, filter));
  const counts = {
    candidate: SIGNAL_FAMILIES.filter((family) => family.status === "candidate").length,
    risk: SIGNAL_FAMILIES.filter((family) => family.status === "risk").length,
    none: SIGNAL_FAMILIES.filter((family) => family.status === "none").length,
    open: SIGNAL_FAMILIES.filter((family) => family.status === "invalid" || family.status === "untested").length,
  };

  return (
    <ResearchFrame>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Research · where an edge could be, and what has been measured</span>
          <h1>Signals</h1>
          <p className="desk-lede">
            Every family of readings the platform holds, the question it would answer, and the measured result so far:
            {" "}{counts.candidate} candidates, {counts.risk} that measure risk, {counts.none} with nothing beyond noise and {counts.open} still open.
            The readings under a card are today's values, not forecasts.
          </p>
        </div>
        <Segmented label="Evidence status" options={FILTERS} value={filter} onChange={setFilter} />
      </div>

      {snapshot.isLoading ? <Shimmer height={420} /> : snapshot.error ? <Notice title="The market snapshot could not be loaded">{snapshot.error.message}</Notice> : null}

      <div className="desk-grid">
        {families.map((family) => {
          const live = readings[family.id];
          return (
            <article key={family.id} className="desk-card desk-signal desk-span-6">
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <h3>{family.title}</h3>
                <EvidenceChip status={family.status} />
              </div>
              <p className="question">{family.question}</p>
              <p>{family.finding}</p>
              <dl>
                <div><dt>Tested on</dt><dd>{family.testedOn}</dd></div>
                <div><dt>What settles it</dt><dd>{family.next}</dd></div>
              </dl>
              {live && live.rows.length > 0 && (
                <div>
                  <div className="desk-muted" style={{ fontSize: 12, marginBottom: 6 }}>{live.caption}</div>
                  <div className="desk-readings">
                    {live.rows.map((row) => (
                      <CompanyLink key={`${family.id}-${row.company.cik}`} company={row.company} className="desk-reading">
                        <span className="desk-ticker">{row.company.ticker}</span>
                        <span className="desk-ink-2">{row.text}</span>
                      </CompanyLink>
                    ))}
                  </div>
                </div>
              )}
              {family.tool && (
                <Link className="desk-link" to={family.tool.path} style={{ fontSize: 13 }}>
                  Open {family.tool.label} <ArrowUpRight size={13} aria-hidden="true" />
                </Link>
              )}
            </article>
          );
        })}
      </div>
      <DevNotes page="signals" />
    </ResearchFrame>
  );
}
