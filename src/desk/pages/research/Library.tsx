import { Link } from "react-router";
import { Activity, ArrowUpRight, BookOpen, MessageSquare, ShieldCheck } from "lucide-react";
import { useDesk, useDocumentTitle } from "../../context";
import { libraryDestinations } from "../../destinations";
import { DevNotes } from "../../DevNotes";
import { ResearchFrame } from "../../ResearchParts";

/** What each page of the Library holds. */
const DETAILS: Record<string, { icon: typeof Activity; text: string }> = {
  "/desk/research/library/volatility-handbook": { icon: BookOpen, text: "The volatility handbook: notation, expected move, the paired tests and their tables." },
  "/desk/messages": { icon: MessageSquare, text: "Conversations with the team, with member-safe contacts and the owner's user intel." },
  "/desk/research/library/factors": { icon: BookOpen, text: "Definitions of the factors and measures, searchable and linked to the measured evidence." },
  "/desk/admin": { icon: ShieldCheck, text: "People, reviewers, structured manuals, job logs and delivery monitors." },
  "/desk/operations?tab=jobs": { icon: Activity, text: "Every job with its switch, schedule, Run and Stop; the runs and their logs; what follows what." },
};

const GROUP_TEXT: Record<string, string> = {
  "Research tools": "The methods behind the research pages.",
  Workspace: "Your messages and the reference pages of the desk.",
  "Owner tools": "Administration and the controls of the data pipeline.",
};

export default function Library() {
  useDocumentTitle("Library");
  const { isAdmin, isPresentation, audienceReady } = useDesk();
  const destinations = libraryDestinations(isAdmin, isPresentation);
  const groups = ["Research tools", "Workspace", "Owner tools"].map((group) => ({ group, items: destinations.filter((destination) => destination.group === group) })).filter((entry) => entry.items.length);
  const content = (
    <>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Research · methods, full records and tools</span>
          <h1>Library</h1>
          <p className="desk-lede">The methods and reference pages behind the desk tools.</p>
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
                  <span className="desk-link desk-nowrap">Open <ArrowUpRight size={13} aria-hidden="true" /></span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
      <DevNotes page="library" />
    </>
  );
  if (!audienceReady) return <ResearchFrame><div /></ResearchFrame>;
  return isPresentation ? <ResearchFrame>{content}</ResearchFrame> : <div>{content}</div>;
}
