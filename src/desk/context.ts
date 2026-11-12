import { createContext, useContext, useEffect } from "react";
import type { ChartPalette } from "./charts/color";
import type { ResolvedTheme, ThemeChoice } from "./preferences";

export interface DeskContextValue {
  palette: ChartPalette;
  theme: { choice: ThemeChoice; resolved: ResolvedTheme; choose: (choice: ThemeChoice) => void };
  isAdmin: boolean;
  /** Owner, or a reviewer who accepted the NDA: the audience of the research tools. */
  isPresentation: boolean;
  /** False while a non-owner's reviewer status is still loading (the audience is not known yet). */
  audienceReady: boolean;
  /** Every signed-in user except a reviewer who has not accepted the NDA: the audience of the fund-flow page. */
  flowsOpen: boolean;
  userName: string;
  openSearch: () => void;
}

export const DeskContext = createContext<DeskContextValue | null>(null);

export function useDesk(): DeskContextValue {
  const value = useContext(DeskContext);
  if (!value) throw new Error("useDesk must be used inside the desk shell");
  return value;
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Alpha Engine`;
    return () => {
      document.title = "Alpha Engine";
    };
  }, [title]);
}
