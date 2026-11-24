import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useReviewer } from "@/hooks/useReviewer";
import ReviewerNdaGate from "./ReviewerNdaGate";
import ReviewerRestrictions from "./ReviewerRestrictions";

export default function ReviewerGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { status } = useReviewer();
  if (!user) return <>{children}</>;
  if (status.isLoading) return <div style={{ minHeight: "100vh" }} aria-hidden="true" />;
  if (status.isError) return (
    <div className="reviewer-modal-backdrop" role="alert">
      <section className="reviewer-nda-panel">
        <span className="t-label">Reviewer access check failed</span>
        <h1>We could not verify the presentation access.</h1>
        <p>Please retry. No content is being inferred or unlocked by this error.</p>
        <button type="button" className="ops-icon-button" onClick={() => void status.refetch()}>Retry</button>
      </section>
    </div>
  );
  if (!status.data?.isReviewer) return <>{children}</>;
  if (!status.data.ndaAccepted) return <ReviewerNdaGate />;
  // the guided tour and page hints went with the classic view (owner, 2026-11-24): the agreement and the restrictions stay
  return <><ReviewerRestrictions />{children}</>;
}
