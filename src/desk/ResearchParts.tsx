import { Link, Navigate, useLocation } from "react-router";
import { AlertTriangle, CircleDashed, FlaskConical, MinusCircle, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useDesk } from "./context";
import { EVIDENCE_LABEL, SIGNAL_FAMILIES, type EvidenceStatus } from "./evidence";

const TABS = [
  { label: "Signals", path: "/desk/research" },
  { label: "Earnings", path: "/desk/research/earnings" },
  { label: "Volatility", path: "/desk/research/volatility" },
  { label: "Macro", path: "/desk/research/macro" },
  { label: "Ownership", path: "/desk/research/ownership" },
  { label: "Library", path: "/desk/research/library" },
];

const ICON: Record<EvidenceStatus, typeof FlaskConical> = {
  candidate: FlaskConical,
  risk: ShieldCheck,
  none: MinusCircle,
  invalid: AlertTriangle,
  untested: CircleDashed,
};

/** Evidence status as an icon and a phrase (never colour alone). */
export function EvidenceChip({ status }: { status: EvidenceStatus }) {
  const Icon = ICON[status];
  return (
    <span className="desk-evidence" data-status={status}>
      <Icon size={13} aria-hidden="true" /> {EVIDENCE_LABEL[status]}
    </span>
  );
}

/** One line of measured evidence for a tool page, taken from the signal ledger. */
export function EvidenceNote({ family, children }: { family: string; children?: ReactNode }) {
  const entry = SIGNAL_FAMILIES.find((item) => item.id === family);
  if (!entry) return null;
  return (
    <div className="desk-card" style={{ display: "grid", gap: 8, marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <strong style={{ fontWeight: 620 }}>{entry.title}</strong>
        <EvidenceChip status={entry.status} />
      </div>
      <p className="desk-ink-2" style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>{entry.finding}</p>
      <p className="desk-muted" style={{ margin: 0, fontSize: 12.5 }}>
        Tested on: {entry.testedOn}. Next: {entry.next}
      </p>
      {children}
    </div>
  );
}

/**
 * Frame of every research page: the audience guard (the owner and reviewers who accepted the NDA, as for the
 * classic research pages) and the tab row.
 */
export function ResearchFrame({ children }: { children: ReactNode }) {
  const { isPresentation, audienceReady } = useDesk();
  const location = useLocation();
  if (!audienceReady) return <div className="desk-shimmer" style={{ height: 320 }} aria-hidden="true" />;
  if (!isPresentation) return <Navigate to="/desk" replace />;
  const path = location.pathname.replace(/\/$/, "");
  return (
    <div>
      <nav className="desk-subnav" aria-label="Research tools">
        {TABS.map((tab) => (
          <Link key={tab.path} to={tab.path} aria-current={path === tab.path ? "page" : undefined}>
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
