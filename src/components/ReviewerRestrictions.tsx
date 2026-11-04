import { useEffect } from "react";
import { useReviewer } from "@/hooks/useReviewer";

/** Deterrents only: browsers cannot truly prevent screenshots or DevTools extraction. */
export default function ReviewerRestrictions() {
  const { user, status } = useReviewer();
  useEffect(() => {
    if (!status.data?.isReviewer || !status.data.ndaAccepted) return;
    const prevent = (event: Event) => event.preventDefault();
    const keys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ["c", "p", "s"].includes(event.key.toLowerCase())) event.preventDefault();
    };
    document.body.classList.add("reviewer-restricted");
    document.addEventListener("copy", prevent);
    document.addEventListener("cut", prevent);
    document.addEventListener("contextmenu", prevent);
    document.addEventListener("dragstart", prevent);
    document.addEventListener("keydown", keys);
    document.addEventListener("beforeprint", prevent);
    return () => {
      document.body.classList.remove("reviewer-restricted");
      document.removeEventListener("copy", prevent);
      document.removeEventListener("cut", prevent);
      document.removeEventListener("contextmenu", prevent);
      document.removeEventListener("dragstart", prevent);
      document.removeEventListener("keydown", keys);
      document.removeEventListener("beforeprint", prevent);
    };
  }, [status.data?.isReviewer, status.data?.ndaAccepted]);
  if (!status.data?.isReviewer || !status.data.ndaAccepted) return null;
  return (
    <>
      <div className="reviewer-watermark" aria-hidden="true">{user?.name} · private preview · {new Date().toISOString().slice(0, 10)}</div>
      <div className="reviewer-print-block" role="note">This private research preview is not intended for redistribution.</div>
    </>
  );
}
