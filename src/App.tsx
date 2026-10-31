import { lazy, Suspense, type ReactNode } from "react";
import { Routes, Route, Link } from "react-router";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import NotFound from "./pages/NotFound";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Universe = lazy(() => import("./pages/Universe"));
const Company = lazy(() => import("./pages/Company"));
const Jobs = lazy(() => import("./pages/Jobs"));
const Screener = lazy(() => import("./pages/Screener"));
const DatabasePage = lazy(() => import("./pages/Database"));
const Lab = lazy(() => import("./pages/Lab"));
const Admin = lazy(() => import("./pages/Admin"));
const Workers = lazy(() => import("./pages/Workers"));
const FundFlows = lazy(() => import("./pages/FundFlows"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Methodology = lazy(() => import("./pages/Methodology"));
const VolatilityRiskLab = lazy(() => import("./pages/VolatilityRiskLab"));
const Expectations = lazy(() => import("./pages/Expectations"));
const MarketData = lazy(() => import("./pages/MarketData"));
const Messages = lazy(() => import("./pages/Messages"));
const Wiki = lazy(() => import("./pages/Wiki"));

/**
 * Route guard for owner-only instruments (Database browser, Sentiment Lab).
 * The nav links are hidden from role="user" (AppLayout, iteration 3c), but a
 * direct URL visit must not render the page either: the underlying queries
 * would 403 anyway, so we fail fast with an explicit screen.
 *
 * This is UI-level gating only — the real authorization stays on the API.
 */
function AdminOnly({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth({ redirectOnUnauthenticated: true })
  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="radar" />
      </div>
    )
  }
  if (user.role !== "admin") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <ShieldAlert size={20} className="text-crit-red" />
        <div className="t-mono text-[12px] text-crit-red">OWNER-ONLY INSTRUMENT — insufficient role</div>
        <Link to="/" className="t-mono text-[11px] text-muted-foreground hover:text-live-cyan underline underline-offset-4">
          back to dashboard
        </Link>
      </div>
    )
  }
  return <>{children}</>
}

export default function App() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="radar" /></div>}>
      <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/universe" element={<Universe />} />
      <Route path="/screener" element={<Screener />} />
      <Route path="/company/:ticker" element={<Company />} />
      <Route path="/jobs" element={<Jobs />} />
      <Route path="/messages" element={<Messages />} />
      <Route path="/wiki" element={<Wiki />} />
      <Route path="/database" element={<AdminOnly><DatabasePage /></AdminOnly>} />
      <Route path="/lab" element={<AdminOnly><Lab /></AdminOnly>} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/workers" element={<AdminOnly><Workers /></AdminOnly>} />
      <Route path="/fundflows" element={<AdminOnly><FundFlows /></AdminOnly>} />
      <Route path="/analytics" element={<AdminOnly><Analytics /></AdminOnly>} />
      <Route path="/analytics/methodology" element={<AdminOnly><Methodology /></AdminOnly>} />
      <Route path="/analytics/risk-lab" element={<AdminOnly><VolatilityRiskLab /></AdminOnly>} />
      <Route path="/expectations" element={<AdminOnly><Expectations /></AdminOnly>} />
      <Route path="/market-data" element={<AdminOnly><MarketData /></AdminOnly>} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
