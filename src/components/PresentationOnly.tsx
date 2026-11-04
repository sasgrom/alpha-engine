import type { ReactNode } from "react";
import { Link } from "react-router";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useReviewer } from "@/hooks/useReviewer";

/** Read-only presentation routes: owner admin or an NDA-accepted reviewer. */
export default function PresentationOnly({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth({ redirectOnUnauthenticated: true });
  const { status } = useReviewer();
  if (isLoading || !user || status.isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="radar" /></div>;
  if (user.role === "admin" || (status.data?.isReviewer && status.data.ndaAccepted)) return <>{children}</>;
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3">
      <ShieldAlert size={20} className="text-crit-red" />
      <div className="t-mono text-[12px] text-crit-red">READ-ONLY PRESENTATION — insufficient role</div>
      <Link to="/" className="t-mono text-[11px] text-muted-foreground hover:text-live-cyan underline underline-offset-4">back to dashboard</Link>
    </div>
  );
}
