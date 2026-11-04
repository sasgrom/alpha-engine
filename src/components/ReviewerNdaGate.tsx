import { useEffect, useRef } from "react";
import { NDA_TEXT, NDA_TITLE, NDA_VERSION } from "@contracts/reviewer";
import { useReviewer } from "@/hooks/useReviewer";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export default function ReviewerNdaGate() {
  const { acceptNda } = useReviewer();
  const { logout } = useAuth();
  const agreeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { agreeRef.current?.focus(); }, []);
  return (
    <div className="reviewer-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="reviewer-nda-title">
      <section className="reviewer-nda-panel">
        <span className="t-label">Private academic preview</span>
        <h1 id="reviewer-nda-title">{NDA_TITLE}</h1>
        <div className="reviewer-nda-copy">{NDA_TEXT.split("\n\n").map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
        <div className="reviewer-nda-meta">Version {NDA_VERSION} · consent records a one-way IP hash, time, user agent and session identity.</div>
        <div className="reviewer-modal-actions">
          <Button type="button" variant="outline" onClick={() => logout()}>Decline and sign out</Button>
          <Button type="button" ref={agreeRef} onClick={() => acceptNda.mutate()} disabled={acceptNda.isPending}>
            {acceptNda.isPending ? "Recording consent…" : "I agree"}
          </Button>
        </div>
        {acceptNda.isError && <p className="reviewer-error" role="alert">Consent could not be recorded. Please retry or contact the owner.</p>}
      </section>
    </div>
  );
}
