import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import {
  LayoutDashboard,
  ListChecks,
  Globe2,
  LogOut,
  Activity,
  ShieldCheck,
  Table2,
  MessageSquare,
  Eye,
  X,
  Menu,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { jobToast } from "@/lib/job-toast";
import { VIEW_AS_KEY } from "@/providers/trpc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { describeJob } from "@/lib/job-describe";

/**
 * Decluttered navigation (iteration 3c, owner decision): regular users get
 * only the three working surfaces. Database and Sentiment Lab are owner
 * instruments — reachable from /admin, hidden here. Admin is the owner's
 * service section.
 */
const NAV = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Globe2, label: "Universe", path: "/universe" },
  // 4a (D28): the daily working surface — universe-wide metrics table
  { icon: Table2, label: "Screener", path: "/screener" },
  { icon: ListChecks, label: "Jobs", path: "/jobs" },
  // 4c (D32): admin ↔ user chat (support threads)
  { icon: MessageSquare, label: "Messages", path: "/messages" },
];

/**
 * Admin menu item: rendered ONLY for role="admin" (platform owner).
 * This is UI hiding — the real guard is on the API (adminQuery): a non-admin
 * who guesses /admin gets FORBIDDEN from every procedure.
 */
const ADMIN_NAV = { icon: ShieldCheck, label: "Admin", path: "/admin" };
const WORKERS_NAV = { icon: Activity, label: "Workers", path: "/workers" };
const FLOWS_NAV = { icon: Activity, label: "Fund flows", path: "/fundflows" };
const ANALYTICS_NAV = { icon: Activity, label: "Analytics", path: "/analytics" };

function UtcClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="t-mono text-[11px] text-muted-foreground">
      {now.toISOString().replace("T", " ").slice(0, 19)} UTC
    </span>
  );
}

/**
 * Targeted cache refresh after a terminal job transition (iteration 3d).
 * invalidate() refetches ONLY the queries currently mounted — so "the table
 * refreshes itself" on whichever page the user is looking at, and nothing
 * else (no full reload, no unrelated refetch storm). jobs.list is already
 * live (it is the watcher's own polling query).
 */
function useInvalidateForJob() {
  const utils = trpc.useUtils();
  return (type: string) => {
    void utils.dashboard.stats.invalidate();
    switch (type) {
      case "bootstrap":
        void utils.universe.list.invalidate();
        void utils.universe.sp500Preview.invalidate();
        void utils.scope.groups.invalidate();
        void utils.dashboard.latestFilings.invalidate();
        void utils.events.byCompany.invalidate(); // 4a: events rebuilt at job end
        void utils.screener.table.invalidate();
        break;
      case "filings":
        void utils.browse.filingsList.invalidate();
        void utils.dashboard.latestFilings.invalidate();
        void utils.universe.list.invalidate();
        void utils.events.byCompany.invalidate();
        void utils.screener.table.invalidate();
        break;
      case "harvest":
        void utils.documents.list.invalidate();
        void utils.documents.stats.invalidate();
        void utils.company.overview.invalidate();
        break;
      case "stream":
        void utils.documents.list.invalidate();
        void utils.documents.stats.invalidate();
        void utils.company.overview.invalidate();
        // stream tops up daily prices after its last cycle (3f, withPrices)
        void utils.prices.history.invalidate();
        void utils.prices.quote.invalidate();
        void utils.events.byCompany.invalidate(); // 4a: stream catches fresh 8-Ks
        void utils.screener.table.invalidate();
        break;
      case "series":
        void utils.series.points.invalidate();
        void utils.series.flagged.invalidate();
        void utils.series.concepts.invalidate();
        void utils.company.overview.invalidate();
        void utils.screener.table.invalidate(); // 4a: series drive screener metrics
        break;
      case "sections":
        void utils.sections.list.invalidate();
        void utils.company.overview.invalidate();
        break;
      case "score":
        void utils.sentiment.byCompany.invalidate();
        void utils.sentiment.tickersWithScores.invalidate();
        void utils.sentiment.labStats.invalidate();
        void utils.company.overview.invalidate();
        void utils.screener.table.invalidate(); // 4a: sentiment column
        break;
      case "prices":
        // 3f: only the price blocks read prices.* — the chart and the quote
        // header refresh in place; nothing else in the app touches them
        void utils.prices.history.invalidate();
        void utils.prices.quote.invalidate();
        void utils.screener.table.invalidate(); // 4a
        break;
      default:
        break;
    }
  };
}

/**
 * Global job-completion watcher (iteration 3c/3d): polls the visible job
 * list (already scoped per user server-side), raises an 8s ring toast on
 * every terminal transition, and invalidates the caches that the finished
 * job writes to — the affected table refreshes in place, no page reload.
 * First paint only snapshots statuses — jobs that finished before the
 * watcher mounted do not toast.
 */
/**
 * 4b (D29): universe remove/restore rows are terminal micro-jobs that exist
 * only as log records — the originating mutation already raised its own
 * toast and invalidated universe.list. A watcher toast on top would be a
 * duplicate for the actor and noise for admins (who see ALL users' queues).
 */
const LOG_ONLY_JOB_TYPES = new Set(["universe-remove", "universe-restore"]);

function useJobWatcher(enabled: boolean) {
  const known = useRef<Map<number, string> | null>(null);
  const invalidateFor = useInvalidateForJob();
  const { data } = trpc.jobs.list.useQuery(
    // 4h review fix: the Jobs page lists 30 — a smaller watcher window would
    // silently miss terminal transitions outside it (no toast, no refresh)
    { limit: 30 },
    { enabled, refetchInterval: 5000 }
  );
  // useEffect instead of onSuccess: React Query v5 removed query callbacks.
  useEffect(() => {
    if (!data) return;
    const prev = known.current;
    known.current = new Map(data.map((j) => [j.id, j.status]));
    if (!prev) return; // initial snapshot — no notifications
    for (const j of data) {
      if (LOG_ONLY_JOB_TYPES.has(j.type)) continue; // self-toasting log records
      const before = prev.get(j.id);
      // before === undefined: the job appeared between polls ALREADY terminal
      // (started and finished inside one 5 s window — short sections/score
      // runs do this). Report it too; otherwise such jobs complete silently
      // (no toast, no cache refresh). The mount snapshot above still
      // suppresses notifications for jobs that finished before we arrived.
      const freshTerminal =
        before === undefined &&
        (j.status === "done" || j.status === "error" || j.status === "cancelled");
      if (!freshTerminal && (!before || before === j.status)) continue;
      const desc = describeJob(j.type, j.params);
      if (j.status === "done") {
        jobToast("success", `Job #${j.id} ${j.type} done`, desc || j.message || undefined);
        invalidateFor(j.type);
      } else if (j.status === "error") {
        jobToast("error", `Job #${j.id} ${j.type} failed`, j.message || desc || undefined);
        invalidateFor(j.type); // partial results may exist — refresh anyway
      } else if (j.status === "cancelled") {
        jobToast("warning", `Job #${j.id} ${j.type} cancelled`, desc || undefined);
      }
    }
  }, [data, invalidateFor]);
}

export default function AppLayout({ children, title }: { children: ReactNode; title: string }) {
  const { user, isLoading, logout } = useAuth({ redirectOnUnauthenticated: true });
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  // 4p: Workers nav entry only on the home machine (LOCAL_WORKER_UI=1 server-side)
  const workersUi = trpc.workersLocal.enabled.useQuery(undefined, { retry: false, enabled: isAdmin });
  const stats = trpc.dashboard.stats.useQuery(undefined, {
    refetchInterval: 5000,
    enabled: !!user,
  });
  useJobWatcher(!!user);

  // 4g: mobile — the fixed sidebar becomes a slide-over drawer (<md).
  // Hooks MUST stay above the isLoading early-return (React #310 — a hook
  // placed after it crashed the whole tree on first paint after load).
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [location.pathname]); // navigating closes the drawer

  // 4e (D36): the admin's read-only view-as lens. The header rides every
  // API call (providers/trpc.tsx); the banner makes the mode impossible to
  // miss and offers the exit. Writes refuse server-side while it is active.
  const utils = trpc.useUtils();
  const [viewAs, setViewAs] = useState<number | null>(() => {
    const v = localStorage.getItem(VIEW_AS_KEY);
    return v ? Number(v) : null;
  });
  useEffect(() => {
    const onChange = () => {
      const v = localStorage.getItem(VIEW_AS_KEY);
      setViewAs(v ? Number(v) : null);
    };
    window.addEventListener("alpha-viewas-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("alpha-viewas-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const viewAsActive = isAdmin && viewAs !== null && viewAs !== user?.id;
  const usersList = trpc.admin.usersList.useQuery(undefined, { enabled: !!viewAsActive, retry: false });
  const viewAsName = usersList.data?.find((u) => u.id === viewAs)?.username ?? (viewAs ? `user ${viewAs}` : null);
  const exitViewAs = () => {
    localStorage.removeItem(VIEW_AS_KEY);
    window.dispatchEvent(new Event("alpha-viewas-changed"));
    void utils.invalidate();
    navigate("/admin");
  };

  // 4e (D35): page-view tracker — one event per path per 60 s, admin's own
  // navigation in view-as mode still records as the ADMIN (server writes
  // ctx.user.id, the lens never touches telemetry)
  const track = trpc.activity.track.useMutation();
  const lastTracked = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!user) return;
    const path = location.pathname;
    const now = Date.now();
    if (now - (lastTracked.current.get(path) ?? 0) < 60_000) return;
    lastTracked.current.set(path, now);
    track.mutate({ path });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, user?.id]);

  // 4c (D32): unread-message badge + a toast when the count GROWS while the
  // user is not on /messages (on the page itself the conversation is already
  // visible — a toast would be noise)
  const unread = trpc.messages.unreadCount.useQuery(undefined, {
    refetchInterval: 15000,
    enabled: !!user,
  });
  const prevUnread = useRef<number | null>(null);
  useEffect(() => {
    const n = unread.data?.count;
    if (n === undefined) return;
    const prev = prevUnread.current;
    prevUnread.current = n;
    if (prev !== null && n > prev && location.pathname !== "/messages") {
      jobToast("info", "New message", "open Messages to read it");
    }
  }, [unread.data, location.pathname]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="radar" />
      </div>
    );
  }

  const running = stats.data?.runningJobs ?? 0;
  const queued = stats.data?.queuedJobs ?? 0; // 4c review fix: FIFO-queued jobs are work too
  const unreadMsgs = unread.data?.count ?? 0;

  // (navOpen state lives above the isLoading return — see the 4g note there)

  /** Nav items shared by the desktop sidebar and the mobile drawer. */
  const renderNavItems = (onNavigate?: () => void) =>
    [...NAV, ...(isAdmin ? [...(workersUi.data?.enabled ? [WORKERS_NAV] : []), ANALYTICS_NAV, FLOWS_NAV, ADMIN_NAV] : [])].map((item) => {
      const active = location.pathname === item.path;
      return (
        <Link
          key={item.path}
          to={item.path}
          onClick={onNavigate}
          className={`flex items-center gap-3 px-4 py-2.5 border-l-2 transition-colors ${
            active
              ? "border-[hsl(var(--live))] text-[hsl(var(--live))] bg-[hsl(var(--accent)/0.35)]"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--accent)/0.2)]"
          }`}
        >
          <item.icon size={15} strokeWidth={1.75} />
          <span className="t-mono text-[11px] uppercase tracking-[0.14em]">{item.label}</span>
          {/* unread badge on Messages (4c, D32) — the messenger cue */}
          {item.path === "/messages" && unreadMsgs > 0 && (
            <span className="ml-auto t-mono text-[9px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--live))] text-[hsl(var(--primary-foreground))]">
              {unreadMsgs}
            </span>
          )}
        </Link>
      );
    });

  const sidebarHeader = (
    <div className="flex items-center gap-3 px-4 h-14 border-b border-border">
      <div className="radar" />
      <div>
        <div className="t-mono text-[13px] font-semibold tracking-[0.18em] text-foreground">
          ALPHA ENGINE
        </div>
        <div className="t-label !text-[9px]">ALPHA-BAYES-MOE-1.0</div>
      </div>
    </div>
  );
  const sidebarLeds = isAdmin && (
    <div className="px-4 py-3 border-t border-border space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="led led-ok" />
        <span className="t-label !text-[9px]">SEC EDGAR FEED</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`led ${running + queued > 0 ? "led-live" : "led-off"}`} />
        <span className="t-label !text-[9px]">
          {running + queued > 0
            ? `${running} RUNNING${queued > 0 ? ` · ${queued} QUEUED` : ""}`
            : "IDLE"}
        </span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex">
      {/* sidebar — desktop only (4g) */}
      <aside className="hidden md:flex w-[220px] shrink-0 border-r border-border bg-[hsl(224_52%_4%)] flex-col fixed inset-y-0 z-30">
        {sidebarHeader}
        <nav className="flex-1 py-3">{renderNavItems()}</nav>
        {sidebarLeds}
      </aside>

      {/* mobile drawer (<md): backdrop + slide-over with the same nav (4g) */}
      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[240px] border-r border-border bg-[hsl(224_52%_4%)] flex flex-col">
            {sidebarHeader}
            <nav className="flex-1 py-3">{renderNavItems(() => setNavOpen(false))}</nav>
            {sidebarLeds}
          </aside>
        </div>
      )}

      {/* main column — min-w-0 (4g): a flex item otherwise refuses to shrink
          below its content width, so the wide table panels pushed the whole
          page 456px sideways on phones */}
      <div className="flex-1 min-w-0 ml-0 md:ml-[220px] flex flex-col min-h-screen">
        <header className="h-14 border-b border-border flex items-center justify-between px-3 md:px-6 sticky top-0 bg-[hsl(224_52%_4%/0.85)] backdrop-blur-md z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="md:hidden text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={18} />
            </button>
            <Activity size={14} className="text-[hsl(var(--live))] shrink-0 hidden sm:block" />
            <h1 className="t-mono text-[13px] font-medium uppercase tracking-[0.18em] truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-5">
            <span className="hidden sm:inline"><UtcClock /></span>
            <DropdownMenu>
              <DropdownMenuTrigger className="outline-none">
                <Avatar className="h-7 w-7 border border-border">
                  <AvatarFallback className="t-mono text-[10px] bg-[hsl(var(--accent))] text-[hsl(var(--live))]">
                    {(user.name ?? "OP").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="t-panel">
                <DropdownMenuItem onClick={logout} className="t-mono text-xs gap-2 cursor-pointer">
                  <LogOut size={13} /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 p-3 md:p-6 max-w-[1400px] w-full mx-auto">
          {/* 4e (D36): the view-as banner — the lens must be unmistakable */}
          {viewAsActive && (
            <div className="mb-4 flex items-center gap-3 px-4 py-2 rounded-md border border-[hsl(var(--warn)/0.4)] bg-[hsl(var(--warn)/0.08)]">
              <Eye size={13} className="text-[hsl(var(--warn))]" />
              <span className="t-mono text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--warn))]">
                Viewing as {viewAsName} · read-only — writes are blocked
              </span>
              <button
                onClick={exitViewAs}
                className="ml-auto inline-flex items-center gap-1 t-mono text-[10px] uppercase text-muted-foreground hover:text-foreground"
              >
                <X size={12} /> Exit
              </button>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
