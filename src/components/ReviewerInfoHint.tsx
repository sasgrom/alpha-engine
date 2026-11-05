import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";
import type { ReviewerGuideContent } from "@/content/reviewer-guide";
import { useReviewerGuide } from "@/hooks/useReviewerGuide";

interface RectState { top: number; left: number; width: number; height: number }
interface LayoutState {
  rect: RectState;
  viewportWidth: number;
  viewportHeight: number;
  popoverStyle: CSSProperties;
  connector: { left: number; top: number; height: number };
}

const FIELDS: Array<[keyof ReviewerGuideContent, string]> = [
  ["decision", "HOW TO USE IT"],
  ["hypothesis", "HYPOTHESIS & LIMITS"],
  ["represents", "WHAT IT REPRESENTS"],
  ["purpose", "WHY THIS TILE EXISTS"],
  ["collection", "SOURCE & COLLECTION"],
  ["cadence", "UPDATE CADENCE"],
  ["mechanics", "CALCULATION PATH / FORMULA"],
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export default function ReviewerInfoHint({
  id,
  content,
  targetElement,
  navigation = false,
}: {
  id: string;
  content: ReviewerGuideContent;
  targetElement?: HTMLElement | null;
  navigation?: boolean;
}) {
  const { enabled, activeGuideId, openGuide, closeGuide } = useReviewerGuide();
  const [layout, setLayout] = useState<LayoutState | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = enabled && activeGuideId === id;
  const popoverId = `reviewer-guide-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const updateLayout = useCallback(() => {
    const target = targetElement ?? triggerRef.current?.closest<HTMLElement>("[data-guide-block]") ?? triggerRef.current;
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    const anchor = triggerRef.current?.getBoundingClientRect() ?? bounds;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height };
    const width = Math.min(430, viewportWidth - 24);
    const left = clamp(anchor.right - width, 12, viewportWidth - width - 12);
    const belowTop = anchor.bottom + 8;
    const below = viewportHeight - belowTop - 12;
    const enoughRoomBelow = below >= 320;
    const top = enoughRoomBelow ? belowTop : 12;
    const maxHeight = enoughRoomBelow ? Math.min(680, below) : viewportHeight - 24;
    const popoverStyle: CSSProperties = {
      left,
      top,
      width,
      maxHeight,
      "--reviewer-popover-top": `${top}px`,
    } as CSSProperties;
    setLayout({
      rect,
      viewportWidth,
      viewportHeight,
      popoverStyle,
      connector: { left: left + width, top: anchor.bottom, height: Math.max(0, top - anchor.bottom) },
    });
  }, [targetElement]);

  const open = useCallback(() => {
    cancelClose();
    updateLayout();
    openGuide(id);
  }, [cancelClose, id, openGuide, updateLayout]);

  const close = useCallback(() => {
    cancelClose();
    closeGuide();
  }, [cancelClose, closeGuide]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(close, 140);
  }, [cancelClose, close]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    };
    const onChange = () => updateLayout();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [active, close, updateLayout]);

  useEffect(() => () => cancelClose(), [cancelClose]);
  if (!enabled) return null;

  const hoverCapable = typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const toggle = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (active) {
      if (!hoverCapable) close();
    } else open();
  };
  const hoverProps = hoverCapable ? {
    onMouseEnter: open,
    onMouseLeave: scheduleClose,
    onFocus: open,
    onBlur: scheduleClose,
  } : {};

  const blurPanels: CSSProperties[] = layout ? [
    { left: 0, top: 0, width: layout.viewportWidth, height: Math.max(0, layout.rect.top) },
    { left: 0, top: layout.rect.top + layout.rect.height, width: layout.viewportWidth, height: Math.max(0, layout.viewportHeight - layout.rect.top - layout.rect.height) },
    { left: 0, top: layout.rect.top, width: Math.max(0, layout.rect.left), height: layout.rect.height },
    { left: layout.rect.left + layout.rect.width, top: layout.rect.top, width: Math.max(0, layout.viewportWidth - layout.rect.left - layout.rect.width), height: layout.rect.height },
  ] : [];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`reviewer-info-trigger${navigation ? " reviewer-info-nav" : ""}`}
        aria-label={`About ${content.title}`}
        aria-expanded={active}
        aria-controls={active ? popoverId : undefined}
        aria-haspopup="dialog"
        data-reviewer-info={id}
        onClick={toggle}
        {...hoverProps}
      >
        <Info size={navigation ? 14 : 17} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {active && layout && createPortal(
        <>
          <div className="reviewer-guide-focus" aria-hidden="true">
            {blurPanels.map((style, index) => <div key={index} style={style} onClick={close} />)}
            <span className="reviewer-guide-outline" style={{ left: layout.rect.left, top: layout.rect.top, width: layout.rect.width, height: layout.rect.height }} />
          </div>
          {layout.connector.height > 0 && <span className="reviewer-guide-connector" style={layout.connector} aria-hidden="true" />}
          <section
            id={popoverId}
            className="reviewer-guide-popover"
            style={layout.popoverStyle}
            role="dialog"
            aria-modal="false"
            aria-labelledby={`${popoverId}-title`}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onFocus={cancelClose}
            onBlur={scheduleClose}
          >
            <div className="reviewer-guide-popover-heading">
              <div>
                <span>EVIDENCE GUIDE</span>
                <h2 id={`${popoverId}-title`}>{content.title}</h2>
              </div>
              <button type="button" aria-label="Close information" onClick={close}><X size={16} /></button>
            </div>
            <dl>
              {FIELDS.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{content[key]}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>,
        document.body,
      )}
    </>
  );
}
