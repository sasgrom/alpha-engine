import { Link } from "react-router";
import { Activity, ArrowUpRight, BookOpen, Briefcase, Database, FileSearch, Gauge, LineChart, ListChecks, MessageSquare, Network, ShieldCheck, SlidersHorizontal, Sparkles, Users, Workflow } from "lucide-react";
import { useDesk, useDocumentTitle } from "../context";
import { classicDestinations } from "../destinations";

const DETAILS: Record<string, { icon: typeof Activity; text: string }> = {
  "/scenario-lab": { icon: SlidersHorizontal, text: "Move rates, oil, the dollar or credit spreads and see which companies' measured sensitivities respond, with the evidence behind each one." },
  "/expectations": { icon: FileSearch, text: "What management guided to, read from each earnings release, and how that guidance compared with what was reported next." },
  "/insider-activity": { icon: Users, text: "Open-market purchases by officers and directors from Form 4 filings, grouped into clusters per company." },
  "/analytics/methodology": { icon: BookOpen, text: "How option-implied volatility compares with recent realized volatility as a forecast of future movement, with the measured results." },
  "/analytics/risk-lab": { icon: Gauge, text: "Option-implied risk profile of a company: expected move by horizon, downside scenarios and how well past ranges held." },
  "/analytics": { icon: Network, text: "Factor and return analytics across the research companies." },
  "/market-data": { icon: LineChart, text: "Coverage and freshness of the option chains and quotes behind the analytics." },
  "/project-state": { icon: Workflow, text: "Where each part of the research programme stands." },
  "/universe": { icon: Briefcase, text: "Choose the companies you follow; they appear in your watchlist on the Today page." },
  "/messages": { icon: MessageSquare, text: "Conversations with the Alpha Engine team." },
  "/jobs": { icon: ListChecks, text: "Data jobs you started and their progress." },
  "/wiki": { icon: BookOpen, text: "Definitions of the factors and measures used across the platform." },
  "/admin": { icon: ShieldCheck, text: "Users, reviewers, manuals and access." },
  "/workers": { icon: Activity, text: "Collectors, the scheduler and their logs, with the controls to run them." },
  "/database": { icon: Database, text: "Browse the stored tables directly." },
  "/lab": { icon: Sparkles, text: "Sentiment scoring of filing sections." },
};

const GROUP_TEXT: Record<string, string> = {
  "Research tools": "The research instruments, opened in the classic view while they move to the desk.",
  Workspace: "Your own lists, messages and jobs.",
  "Owner tools": "Administration and the data pipeline.",
};

export default function Research() {
  useDocumentTitle("Research");
  const { isAdmin, isPresentation } = useDesk();
  const destinations = classicDestinations(isAdmin, isPresentation);
  const groups = ["Research tools", "Workspace", "Owner tools"].map((group) => ({ group, items: destinations.filter((destination) => destination.group === group) })).filter((entry) => entry.items.length);
  return (
    <div>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Research</span>
          <h1>Tools and workspace</h1>
          <p className="desk-lede">Everything beyond the market overview, in one place. These pages open in the classic view; your desk stays one click away.</p>
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
                  <span className="desk-link">Open <ArrowUpRight size={13} style={{ verticalAlign: -2 }} aria-hidden="true" /></span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
