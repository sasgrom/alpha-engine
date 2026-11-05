import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { reviewerTileGuide, type ReviewerGuideContent } from "@/content/reviewer-guide";
import { useReviewerGuide } from "@/hooks/useReviewerGuide";
import ReviewerInfoHint from "./ReviewerInfoHint";

interface GuideTarget {
  id: string;
  host: HTMLElement;
  element: HTMLElement;
  content: ReviewerGuideContent;
}

function headingFor(element: HTMLElement) {
  const heading = (element.querySelector("h1,h2,h3,h4,[data-guide-title],.t-label")?.textContent ?? "").replace(/\s+/g, " ").trim();
  if (heading === "Exchange") {
    const ticker = element.querySelector(".t-mono")?.textContent?.trim();
    if (ticker) return `${ticker} · company identity`;
  }
  return heading.slice(0, 100);
}

export default function ReviewerGuideLayer() {
  const { enabled, closeGuide } = useReviewerGuide();
  const location = useLocation();
  const [targets, setTargets] = useState<GuideTarget[]>([]);
  const targetsRef = useRef<GuideTarget[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const hosts = new Map<HTMLElement, HTMLElement>();
    let frame = 0;
    let disposed = false;

    const commit = (next: GuideTarget[]) => {
      const previous = targetsRef.current;
      const same = previous.length === next.length && previous.every((target, index) => target.id === next[index]?.id && target.content.title === next[index]?.content.title);
      if (same) return;
      targetsRef.current = next;
      setTargets(next);
    };

    const scan = () => {
      frame = 0;
      if (disposed) return;
      const seen = new Set<HTMLElement>();
      const next: GuideTarget[] = [];
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("main .t-panel, main .t-panel-inset, main .panel"));
      for (const element of candidates) {
        if (element.matches("a,button,[role='tablist'],[data-guide-ignore]") || element.closest("a,button,[data-guide-ignore],[aria-hidden='true']")) continue;
        const bounds = element.getBoundingClientRect();
        if (element.offsetParent === null || bounds.width < 160 || bounds.height < 64) continue;
        seen.add(element);
        let host = hosts.get(element);
        if (!host || !host.isConnected) {
          host = document.createElement("span");
          host.className = "reviewer-guide-host";
          host.setAttribute("data-reviewer-guide-host", "");
          element.appendChild(host);
          hosts.set(element, host);
        }
        element.classList.add("reviewer-guide-block");
        element.setAttribute("data-guide-block", "");
        const index = next.length;
        const heading = headingFor(element);
        const id = `${location.pathname}:tile:${index}:${heading || "panel"}`;
        element.setAttribute("data-reviewer-guide-tile", id);
        next.push({ id, host, element, content: reviewerTileGuide(location.pathname, heading, element.textContent ?? "") });
      }
      for (const [element, host] of hosts) {
        if (seen.has(element)) continue;
        host.remove();
        element.classList.remove("reviewer-guide-block");
        element.removeAttribute("data-guide-block");
        element.removeAttribute("data-reviewer-guide-tile");
        hosts.delete(element);
      }
      commit(next);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(scan);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      for (const [element, host] of hosts) {
        host.remove();
        element.classList.remove("reviewer-guide-block");
        element.removeAttribute("data-guide-block");
        element.removeAttribute("data-reviewer-guide-tile");
      }
      targetsRef.current = [];
      setTargets([]);
      closeGuide();
    };
  }, [enabled, location.pathname]);

  if (!enabled) return null;
  return <>{targets.map((target) => createPortal(
    <ReviewerInfoHint key={target.id} id={target.id} content={target.content} targetElement={target.element} />,
    target.host,
  ))}</>;
}
