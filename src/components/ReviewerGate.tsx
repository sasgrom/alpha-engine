import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useReviewer } from "@/hooks/useReviewer";
import ReviewerNdaGate from "./ReviewerNdaGate";
import ReviewerTour from "./ReviewerTour";
import ReviewerRestrictions from "./ReviewerRestrictions";

export default function ReviewerGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { status } = useReviewer();
  if (!user) return <>{children}</>;
  if (status.isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="radar" /></div>;
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
  if (status.data?.isReviewer && !status.data.ndaAccepted) return <ReviewerNdaGate />;
  return <><ReviewerTour /><ReviewerRestrictions />{children}</>;
}
