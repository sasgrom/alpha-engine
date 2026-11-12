import { Link } from "react-router";
import { Activity, ArrowUpRight, BookOpen, Database, FileSearch, Gauge, LineChart, ListChecks, MessageSquare, Network, ShieldCheck, SlidersHorizontal, Sparkles, Users, Workflow } from "lucide-react";
import { useDesk, useDocumentTitle } from "../../context";
import { classicDestinations } from "../../destinations";
import { DevNotes } from "../../DevNotes";
import { ResearchFrame } from "../../ResearchParts";

/** What each classic page still holds that its desk counterpart does not. */
const DETAILS: Record<string, { icon: typeof Activity; text: string; desk?: string }> = {
  "/scenario-lab": { icon: SlidersHorizontal, text: "Every shock channel with the filing evidence behind each company's number, custom shock sizes and the JSON export.", desk: "Macro shows the rate ranking and what is computable." },
  "/expectations": { icon: FileSearch, text: "The full guidance record: every statement read from 26,000 documents, with its quote, period and revision.", desk: "Earnings shows reactions and dates; guidance is not in the desk yet." },
  "/insider-activity": { icon: Users, text: "All Form 4 transactions with the excluded codes, per-company filters and the cluster detail.", desk: "Ownership shows the purchases, the multi-insider windows and the dry-run benchmark." },
  "/analytics/methodology": { icon: BookOpen, text: "The volatility handbook: notation, expected move, the paired tests and their tables.", desk: "Volatility quotes its headline results." },
  "/analytics/risk-lab": { icon: Gauge, text: "A historical replay of one company's implied and realized expected move against the actual outcome.", desk: "Volatility has the sizing calculator on today's readings." },
  "/analytics": { icon: Network, text: "The weekly evidence review: the map of what is built, partial and unproven, and the option hypothesis ledger.", desk: "Signals is the ledger of measured results." },
  "/market-data": { icon: LineChart, text: "Coverage and provenance of the Schwab chains, quotes and intraday context.", desk: "Operations shows capture health." },
  "/project-state": { icon: Workflow, text: "Where code, collection, evidence and delivery each stand." },
  "/universe": { icon: ListChecks, text: "Add companies outside the index (starts a data job), groups and presets.", desk: "Watchlist follows and unfollows index companies." },
  "/messages": { icon: MessageSquare, text: "Conversations with the team." },
  "/jobs": { icon: ListChecks, text: "Data jobs and their logs." },
  "/wiki": { icon: BookOpen, text: "Definitions of the factors and measures." },
  "/admin": { icon: ShieldCheck, text: "Users, reviewers, manuals and access." },
  "/workers": { icon: Activity, text: "Run and stop collectors, the scheduler, logs and the runbook.", desk: "Operations is the read-only health view." },
  "/database": { icon: Database, text: "Browse stored tables, filings and concept series." },
  "/lab": { icon: Sparkles, text: "Sentiment scoring of filing sections." },
};

const GROUP_TEXT: Record<string, string> = {
  "Research tools": "The classic research pages. Each still holds detail its desk tool does not show yet.",
  Workspace: "Your lists, messages and jobs in the classic view.",
  "Owner tools": "Administration and the controls of the data pipeline.",
};

export default function Library() {
  useDocumentTitle("Library");
  const { isAdmin, isPresentation } = useDesk();
  const destinations = classicDestinations(isAdmin, isPresentation);
  const groups = ["Research tools", "Workspace", "Owner tools"].map((group) => ({ group, items: destinations.filter((destination) => destination.group === group) })).filter((entry) => entry.items.length);
  return (
    <ResearchFrame>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Research · methods, full records and the classic tools</span>
          <h1>Library</h1>
          <p className="desk-lede">The detailed records behind the desk tools. These pages open in the classic view; the note under each says what the desk already covers.</p>
        </div>
      </div>
      {groups.map(({ group, items }) => (
        <section key={group} style={{ marginBottom: 30 }}>
          <h2 className="desk-section-title" style={{ marginTop: 6, marginBottom: 4 }}>{group}</h2>
          <p className="desk-muted" style={{ margin: "0 0 14px", fontSize: 13 }}>{GROUP_TEXT[group]}</p>
          <div className="desk-grid">
            {items.map((item) => {
              const detail = DETAILS[item.path];
              const Icon = detail?.icon ?? Activity;
              return (
                <Link key={item.path} to={item.path} className="desk-card desk-tool desk-span-4">
                  <span className="desk-tool-icon"><Icon size={19} aria-hidden="true" /></span>
                  <h3>{item.label}</h3>
                  <p>{detail?.text ?? ""}</p>
                  {detail?.desk && <p className="desk-muted" style={{ fontSize: 12.5 }}>In the desk: {detail.desk}</p>}
                  <span className="desk-link desk-nowrap">Open in the classic view <ArrowUpRight size={13} aria-hidden="true" /></span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
      <DevNotes page="library" />
    </ResearchFrame>
  );
}
