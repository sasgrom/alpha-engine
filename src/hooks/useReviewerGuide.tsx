import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface ReviewerGuideContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  tourDismissed: boolean;
  dismissTour: () => void;
  activeGuideId: string | null;
  openGuide: (id: string) => void;
  closeGuide: () => void;
}

const ReviewerGuideContext = createContext<ReviewerGuideContextValue>({
  enabled: true,
  setEnabled: () => undefined,
  tourDismissed: false,
  dismissTour: () => undefined,
  activeGuideId: null,
  openGuide: () => undefined,
  closeGuide: () => undefined,
});

const enabledKey = (userId: number) => `alpha.reviewer.guide.enabled.${userId}`;
const tourKey = (userId: number) => `alpha.reviewer.tour.dismissed.${userId}`;

export function ReviewerGuideProvider({ userId, children }: { userId: number; children: ReactNode }) {
  const [enabled, setEnabledState] = useState(() => localStorage.getItem(enabledKey(userId)) !== "0");
  const [tourDismissed, setTourDismissed] = useState(() => sessionStorage.getItem(tourKey(userId)) === "1");
  const [activeGuideId, setActiveGuideId] = useState<string | null>(null);

  useEffect(() => {
    setEnabledState(localStorage.getItem(enabledKey(userId)) !== "0");
    setTourDismissed(sessionStorage.getItem(tourKey(userId)) === "1");
    setActiveGuideId(null);
  }, [userId]);

  const setEnabled = (next: boolean) => {
    setEnabledState(next);
    localStorage.setItem(enabledKey(userId), next ? "1" : "0");
    if (!next) {
      setTourDismissed(true);
      sessionStorage.setItem(tourKey(userId), "1");
      setActiveGuideId(null);
    }
  };

  const dismissTour = () => {
    setTourDismissed(true);
    sessionStorage.setItem(tourKey(userId), "1");
  };

  const value = useMemo<ReviewerGuideContextValue>(() => ({
    enabled,
    setEnabled,
    tourDismissed,
    dismissTour,
    activeGuideId,
    openGuide: (id) => setActiveGuideId(id),
    closeGuide: () => setActiveGuideId(null),
  }), [enabled, tourDismissed, activeGuideId, userId]);

  return <ReviewerGuideContext.Provider value={value}>{children}</ReviewerGuideContext.Provider>;
}

export function useReviewerGuide() {
  return useContext(ReviewerGuideContext);
}
