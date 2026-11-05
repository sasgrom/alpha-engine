import { useEffect, useState } from "react";
import { REVIEWER_TOURS, type ReviewerTourTrack } from "@contracts/reviewer";
import { useReviewer } from "@/hooks/useReviewer";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, BookOpen, Map, X } from "lucide-react";
import { useReviewerGuide } from "@/hooks/useReviewerGuide";

export default function ReviewerTour() {
  const { status, tourAction } = useReviewer();
  const { enabled, tourDismissed, dismissTour } = useReviewerGuide();
  const [activeTrack, setActiveTrack] = useState<ReviewerTourTrack | null>(null);
  const tours = status.data?.tours ?? [];
  const inProgress = tours.find((tour) => tour.status === "in_progress");
  const suggested = tours.find((tour) => tour.status === "not_started");
  useEffect(() => { if (inProgress) setActiveTrack(inProgress.track as ReviewerTourTrack); }, [inProgress?.track]);
  if (!enabled || tourDismissed || (!inProgress && !suggested)) return null;

  const act = (track: ReviewerTourTrack, action: "start" | "next" | "previous" | "skip_now" | "dismiss_forever" | "restart") => {
    const currentStep = tours.find((tour) => tour.track === track)?.currentStep ?? 0;
    const finished = action === "next" && currentStep >= REVIEWER_TOURS[track].steps.length - 1;
    if (finished || action === "skip_now" || action === "dismiss_forever") {
      setActiveTrack(null);
      dismissTour();
    }
    tourAction.mutate({ track, action });
  };
  const track = (activeTrack ?? inProgress?.track ?? null) as ReviewerTourTrack | null;
  const definition = track ? REVIEWER_TOURS[track] : null;
  const current = track ? tours.find((tour) => tour.track === track) : null;
  const stepIndex = current?.currentStep ?? 0;
  const step = definition?.steps[stepIndex];

  if (!track || !definition) {
    return (
      <div className="reviewer-tour-backdrop" role="dialog" aria-modal="true" aria-labelledby="tour-choice-title">
        <section className="reviewer-tour-panel reviewer-tour-choice">
          <span className="t-label"><Map size={14} /> Two ways to explore</span>
          <h2 id="tour-choice-title">Choose the presentation that fits your review.</h2>
          <p>Both tours are short, read-only and availability-focused. You can also take them in either order later.</p>
          <div className="reviewer-tour-track-options">
            {(Object.keys(REVIEWER_TOURS) as ReviewerTourTrack[]).map((id) => (
              <button key={id} type="button" onClick={() => act(id, "start")}>
                <span>{id === "geography" ? "01" : "02"}</span>
                <strong>{REVIEWER_TOURS[id].title}</strong>
                <small>{REVIEWER_TOURS[id].subtitle}</small>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
          <button type="button" className="reviewer-tour-text-button" onClick={() => act((suggested?.track ?? "geography") as ReviewerTourTrack, "dismiss_forever")}><X size={13} />Never show this tour again</button>
        </section>
      </div>
    );
  }

  return (
    <div className="reviewer-tour-backdrop" role="dialog" aria-modal="true" aria-labelledby="reviewer-tour-title">
      <section className="reviewer-tour-panel">
        <div className="reviewer-tour-heading">
          <div><span className="t-label"><BookOpen size={14} /> {definition.subtitle}</span><h2 id="reviewer-tour-title">{definition.title}</h2></div>
          <span className="reviewer-tour-progress">{stepIndex + 1} / {definition.steps.length}</span>
        </div>
        <div className="reviewer-tour-progress-line"><span style={{ width: `${((stepIndex + 1) / definition.steps.length) * 100}%` }} /></div>
        {step && <article key={`${track}-${stepIndex}`} className="reviewer-tour-step" aria-live="polite">
          <span className="reviewer-tour-step-number">0{stepIndex + 1}</span>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </article>}
        <div className="reviewer-tour-controls">
          <Button type="button" variant="outline" disabled={stepIndex === 0 || tourAction.isPending} onClick={() => act(track, "previous")}><ArrowLeft size={14} />Back</Button>
          <Button type="button" disabled={tourAction.isPending} onClick={() => act(track, "next")}>{stepIndex === definition.steps.length - 1 ? "Finish" : "Next"}<ArrowRight size={14} /></Button>
        </div>
        <div className="reviewer-tour-footer">
          <button type="button" className="reviewer-tour-text-button" onClick={() => act(track, "skip_now")}>Skip for now</button>
          <button type="button" className="reviewer-tour-text-button" onClick={() => act(track, "dismiss_forever")}>Never show again</button>
          <button type="button" className="reviewer-tour-text-button" onClick={() => act(track, "restart")}>Restart</button>
        </div>
      </section>
    </div>
  );
}
