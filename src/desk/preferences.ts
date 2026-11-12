import { useEffect, useState } from "react";

/**
 * Per-viewer conveniences of the desk view, kept in browser storage: the theme choice, which view the site opens
 * in, and recently opened companies. Storage can be unavailable (private windows, blocked site data), so every
 * access is guarded and the defaults always work.
 */
const THEME_KEY = "alpha.desk.theme";
const VIEW_KEY = "alpha.view";
const RECENT_KEY = "alpha.desk.recent";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // a blocked storage only loses the convenience
  }
}

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useDeskTheme(): { choice: ThemeChoice; resolved: ResolvedTheme; choose: (choice: ThemeChoice) => void } {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const stored = read(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  });
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const choose = (next: ThemeChoice) => {
    setChoice(next);
    write(THEME_KEY, next === "system" ? null : next);
  };
  return { choice, resolved: choice === "system" ? (systemDark ? "dark" : "light") : choice, choose };
}

export type ViewChoice = "desk" | "classic";

/** The view "/" opens in: the desk unless the viewer switched to the classic view last. */
export function preferredView(): ViewChoice {
  return read(VIEW_KEY) === "classic" ? "classic" : "desk";
}

export function rememberView(view: ViewChoice): void {
  write(VIEW_KEY, view);
}

export function recentTickers(): string[] {
  try {
    const value = JSON.parse(read(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function rememberTicker(ticker: string): void {
  write(RECENT_KEY, JSON.stringify([ticker, ...recentTickers().filter((item) => item !== ticker)].slice(0, 6)));
}
