/**
 * The desk view's frame: top navigation, search (Ctrl+K or "/"), the account menu with theme and the switch back
 * to the classic view, the admin's view-as banner, page-view telemetry like the classic layout, and the footer.
 * It loads only what every page needs — the account, the market snapshot and the unread-message count — and
 * never the slow dashboard counters.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Eye, LogOut, MessageSquare, Search, Undo2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useReviewer } from "@/hooks/useReviewer";
import { trpc, VIEW_AS_KEY } from "@/providers/trpc";
import { CHART_PALETTE } from "./charts/color";
import { CommandPalette } from "./CommandPalette";
import { DeskContext, type DeskContextValue } from "./context";
import { classicDestinations, type PaletteDestination } from "./destinations";
import { fmtDate, initials } from "./format";
import { rememberView, useDeskTheme, type ThemeChoice } from "./preferences";
import "./desk.css";

const NAV = [
  { label: "Today", path: "/desk" },
  { label: "Markets", path: "/desk/markets" },
  { label: "Screener", path: "/desk/screener" },
  { label: "Research", path: "/desk/research" },
];

function BrandGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 12.5 6 8.2l3 2.3 5-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

export default function DeskShell({ children }: { children: ReactNode }) {
  const { user, isLoading, logout } = useAuth({ redirectOnUnauthenticated: true });
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useDeskTheme();
  const reviewer = useReviewer();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === "admin";
  const isReviewer = Boolean(reviewer.status.data?.isReviewer);
  const isPresentation = isAdmin || Boolean(reviewer.status.data?.isReviewer && reviewer.status.data.ndaAccepted);
  const snapshot = trpc.desk.snapshot.useQuery(undefined, { enabled: !!user, staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 });
  const unread = trpc.messages.unreadCount.useQuery(undefined, { enabled: !!user && !isReviewer, refetchInterval: 30_000 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // the page behind the desk wears the desk's plane, so overscroll never flashes the classic background
  useEffect(() => {
    const body = document.body;
    const previous = { background: body.style.background, backgroundImage: body.style.backgroundImage };
    body.style.background = theme.resolved === "dark" ? "#0d0d0d" : "#f9f9f7";
    body.style.backgroundImage = "none";
    document.documentElement.style.colorScheme = theme.resolved;
    return () => {
      body.style.background = previous.background;
      body.style.backgroundImage = previous.backgroundImage;
      document.documentElement.style.colorScheme = "";
    };
  }, [theme.resolved]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if ((event.key === "k" || event.key === "K") && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      } else if (event.key === "/" && !typing) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // the admin's read-only view-as lens, as in the classic layout
  const [viewAs, setViewAs] = useState<number | null>(() => {
    try {
      const value = localStorage.getItem(VIEW_AS_KEY);
      return value ? Number(value) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const onChange = () => {
      try {
        const value = localStorage.getItem(VIEW_AS_KEY);
        setViewAs(value ? Number(value) : null);
      } catch {
        setViewAs(null);
      }
    };
    window.addEventListener("alpha-viewas-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("alpha-viewas-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const viewAsActive = isAdmin && viewAs !== null && viewAs !== user?.id;
  const users = trpc.admin.usersList.useQuery(undefined, { enabled: viewAsActive, retry: false });
  const viewAsName = users.data?.find((row) => row.id === viewAs)?.username ?? (viewAs ? `user ${viewAs}` : "");
  const exitViewAs = () => {
    try {
      localStorage.removeItem(VIEW_AS_KEY);
    } catch {
      // nothing stored
    }
    window.dispatchEvent(new Event("alpha-viewas-changed"));
    void utils.invalidate();
  };

  // page-view telemetry: one event per path per minute, never for reviewers (same rule as the classic layout)
  const track = trpc.activity.track.useMutation();
  const tracked = useRef(new Map<string, number>());
  useEffect(() => {
    if (!user || reviewer.status.isLoading || isReviewer) return;
    const now = Date.now();
    if (now - (tracked.current.get(location.pathname) ?? 0) < 60_000) return;
    tracked.current.set(location.pathname, now);
    track.mutate({ path: location.pathname });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, user?.id, reviewer.status.isLoading, isReviewer]);

  const destinations = useMemo<PaletteDestination[]>(
    () => [
      { label: "Today", path: "/desk", group: "Desk", keywords: "home overview brief" },
      { label: "Markets", path: "/desk/markets", group: "Desk", keywords: "map heatmap sectors treemap" },
      { label: "Screener", path: "/desk/screener", group: "Desk", keywords: "table filter sort companies" },
      { label: "Research", path: "/desk/research", group: "Desk", keywords: "tools labs" },
      ...(isAdmin ? [{ label: "Operations", path: "/desk/operations", group: "Desk" as const, keywords: "health scheduler jobs checks" }] : []),
      ...classicDestinations(isAdmin, isPresentation),
    ],
    [isAdmin, isPresentation],
  );

  const context = useMemo<DeskContextValue>(
    () => ({ palette: CHART_PALETTE[theme.resolved], theme, isAdmin, isPresentation, userName: user?.name ?? user?.username ?? "", openSearch: () => setSearchOpen(true) }),
    [theme, isAdmin, isPresentation, user?.name, user?.username],
  );

  if (isLoading || !user) {
    return (
      <div className="desk-root" data-theme={theme.resolved}>
        <div className="desk-loading">Loading your desk…</div>
      </div>
    );
  }

  const navItems = [...NAV, ...(isAdmin ? [{ label: "Operations", path: "/desk/operations" }] : [])];
  const current = (path: string) => (path === "/desk" ? location.pathname === "/desk" || location.pathname === "/desk/" : location.pathname.startsWith(path));
  const unreadCount = unread.data?.count ?? 0;
  const roleLabel = isAdmin ? "Owner" : isReviewer ? "Reviewer" : "Member";
  const chooseTheme = (choice: ThemeChoice) => theme.choose(choice);
  const toClassic = () => {
    rememberView("classic");
    navigate("/terminal");
  };

  return (
    <DeskContext.Provider value={context}>
      <div className="desk-root" data-theme={theme.resolved}>
        <header className="desk-header">
          <div className="desk-header-inner">
            <Link to="/desk" className="desk-brand" aria-label="Alpha Engine home">
              <span className="desk-brand-mark"><BrandGlyph /></span>
              Alpha Engine
            </Link>
            <nav className="desk-nav" aria-label="Main">
              {navItems.map((item) => (
                <Link key={item.path} to={item.path} aria-current={current(item.path) ? "page" : undefined}>
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="desk-header-actions">
              <button type="button" className="desk-search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search companies and pages">
                <Search size={15} aria-hidden="true" />
                <span>Search companies, pages…</span>
                <kbd className="desk-kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>
              </button>
              <div ref={menuRef} style={{ position: "relative" }}>
                <button type="button" className="desk-avatar" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Account menu" onClick={() => setMenuOpen((open) => !open)}>
                  {initials(user.name ?? user.username)}
                  {unreadCount > 0 && <span aria-hidden="true" style={{ position: "absolute", top: -2, right: -2, width: 9, height: 9, borderRadius: 9, background: "var(--d-accent)", boxShadow: "0 0 0 2px var(--d-page)" }} />}
                </button>
                {menuOpen && (
                  <div className="desk-menu" role="menu">
                    <div className="desk-menu-head">
                      <strong>{user.name ?? user.username}</strong>
                      <small>{roleLabel}</small>
                    </div>
                    <div className="desk-menu-label">Theme</div>
                    <div className="desk-theme-options">
                      {(["system", "light", "dark"] as ThemeChoice[]).map((choice) => (
                        <button key={choice} type="button" aria-pressed={theme.choice === choice} onClick={() => chooseTheme(choice)}>
                          {choice === "system" ? "System" : choice === "light" ? "Light" : "Dark"}
                        </button>
                      ))}
                    </div>
                    {!isReviewer && (
                      <Link to="/messages" role="menuitem">
                        <MessageSquare size={15} aria-hidden="true" /> Messages
                        {unreadCount > 0 && <span className="desk-badge accent" style={{ marginLeft: "auto" }}>{unreadCount} new</span>}
                      </Link>
                    )}
                    <button type="button" role="menuitem" onClick={toClassic}>
                      <Undo2 size={15} aria-hidden="true" /> Switch to the classic view
                    </button>
                    <button type="button" role="menuitem" onClick={logout}>
                      <LogOut size={15} aria-hidden="true" /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
        {viewAsActive && (
          <div className="desk-banner" role="status">
            <div>
              <Eye size={15} aria-hidden="true" />
              <span>Viewing as {viewAsName} · read-only, writes are blocked</span>
              <button type="button" onClick={exitViewAs}>Exit</button>
            </div>
          </div>
        )}
        <main className="desk-main">{children}</main>
        <footer className="desk-footer">
          <span>Alpha Engine</span>
          <span>Research data, not investment advice.</span>
          {snapshot.data && <span>Market data through {fmtDate(snapshot.data.session)}</span>}
          <span className="spacer" />
          <span>Press {isMac ? "⌘K" : "Ctrl K"} to search</span>
          <button type="button" onClick={toClassic} style={{ border: "none", background: "transparent", color: "var(--d-ink-2)", font: "inherit", cursor: "pointer", padding: 0 }}>
            Classic view
          </button>
        </footer>
        {searchOpen && (
          <CommandPalette
            companies={snapshot.data?.companies ?? []}
            destinations={destinations}
            onClose={() => setSearchOpen(false)}
            onTheme={chooseTheme}
            onSignOut={logout}
          />
        )}
      </div>
    </DeskContext.Provider>
  );
}
