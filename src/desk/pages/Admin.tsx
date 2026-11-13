import { Navigate, useSearchParams } from "react-router";
import { BookOpen, ClipboardList, ScrollText, Users, UsersRound } from "lucide-react";
import { useDesk, useDocumentTitle } from "../context";
import { DevNotes } from "../DevNotes";
import People from "../admin/People";
import Reviewers from "../admin/Reviewers";
import Manuals from "../admin/Manuals";
import Logs from "../admin/Logs";
import Monitors from "../admin/Monitors";

const TABS = [
  { id: "people", label: "People", icon: Users },
  { id: "reviewers", label: "Reviewers", icon: UsersRound },
  { id: "manuals", label: "Manuals", icon: BookOpen },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "monitors", label: "Monitors", icon: ClipboardList },
] as const;
type AdminTab = (typeof TABS)[number]["id"];

export default function Admin() {
  useDocumentTitle("Owner tools");
  const { isAdmin } = useDesk();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab: AdminTab = TABS.some((item) => item.id === requested) ? requested as AdminTab : "people";
  if (!isAdmin) return <Navigate to="/desk" replace />;
  return (
    <div>
      <div className="desk-page-head">
        <div><span className="desk-eyebrow">Owner only</span><h1>Owner tools</h1><p className="desk-lede">Accounts, reviewer access, project manuals, pipeline logs and delivery monitors.</p></div>
      </div>
      <div className="desk-tabs" role="tablist" aria-label="Owner tools">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setParams(id === "people" ? {} : { tab: id })}><Icon size={14} aria-hidden="true" /> {label}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "people" && <People />}
        {tab === "reviewers" && <Reviewers />}
        {tab === "manuals" && <Manuals />}
        {tab === "logs" && <Logs />}
        {tab === "monitors" && <Monitors />}
      </div>
      <DevNotes page="admin" />
    </div>
  );
}
