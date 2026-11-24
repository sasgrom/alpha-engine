import { lazy, Suspense, type ReactNode } from "react";
import { Routes, Route, Link, Navigate, useLocation } from "react-router";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import NotFound from "./pages/NotFound";
import ReviewerGate from "./components/ReviewerGate";
import PresentationOnly from "./components/PresentationOnly";
import { preferredView } from "./desk/preferences";

const Desk = lazy(() => import("./desk/DeskApp"));
const SignIn = lazy(() => import("./desk/pages/SignIn"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Terminal = lazy(() => import("./pages/Terminal"));
const Company = lazy(() => import("./pages/Company"));
const Screener = lazy(() => import("./pages/Screener"));
const DatabasePage = lazy(() => import("./pages/Database"));
const Lab = lazy(() => import("./pages/Lab"));
const Analytics = lazy(() => import("./pages/Analytics"));
const VolatilityRiskLab = lazy(() => import("./pages/VolatilityRiskLab"));
const Expectations = lazy(() => import("./pages/Expectations"));
const InsiderActivity = lazy(() => import("./pages/InsiderActivity"));
const MarketData = lazy(() => import("./pages/MarketData"));
const ProjectState = lazy(() => import("./pages/ProjectState"));

/** Direct URLs cannot bypass the owner-page guard; procedures also enforce the role on the server. */
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

function FactorWikiRedirect() {
  const { hash } = useLocation();
  return <Navigate to={{ pathname: "/desk/research/library/factors", hash }} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="radar" /></div>}>
      <ReviewerGate><Routes>
      {/* "/" opens the view the viewer used last: the new desk by default, the classic terminal after a switch back */}
      <Route path="/" element={<Navigate to={preferredView() === "classic" ? "/terminal" : "/desk"} replace />} />
      <Route path="/desk/*" element={<Desk />} />
      <Route path="/terminal" element={<Terminal />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/universe" element={<Navigate to="/desk/watchlist" replace />} />
      <Route path="/screener" element={<Screener />} />
      <Route path="/company/:ticker" element={<Company />} />
      <Route path="/jobs" element={<AdminOnly><Navigate to="/desk/operations?tab=runs" replace /></AdminOnly>} />
      <Route path="/messages" element={<Navigate to="/desk/messages" replace />} />
      <Route path="/wiki" element={<FactorWikiRedirect />} />
      <Route path="/database" element={<AdminOnly><DatabasePage /></AdminOnly>} />
      <Route path="/lab" element={<AdminOnly><Lab /></AdminOnly>} />
      <Route path="/admin" element={<AdminOnly><Navigate to="/desk/admin" replace /></AdminOnly>} />
      <Route path="/workers" element={<AdminOnly><Navigate to="/desk/operations?tab=jobs" replace /></AdminOnly>} />
      <Route path="/project-state" element={<PresentationOnly><ProjectState /></PresentationOnly>} />
      <Route path="/analytics" element={<PresentationOnly><Analytics /></PresentationOnly>} />
      <Route path="/analytics/methodology" element={<PresentationOnly><Navigate to="/desk/research/library/volatility-handbook" replace /></PresentationOnly>} />
      <Route path="/analytics/risk-lab" element={<PresentationOnly><VolatilityRiskLab /></PresentationOnly>} />
      <Route path="/scenario-lab" element={<Navigate to="/desk/research/macro?view=scenarios" replace />} />
      <Route path="/expectations" element={<PresentationOnly><Expectations /></PresentationOnly>} />
      <Route path="/insider-activity" element={<PresentationOnly><InsiderActivity /></PresentationOnly>} />
      <Route path="/market-data" element={<PresentationOnly><MarketData /></PresentationOnly>} />
      <Route path="/login" element={<SignIn mode="signin" />} />
      <Route path="/signup" element={<SignIn mode="signup" />} />
      <Route path="*" element={<NotFound />} />
      </Routes></ReviewerGate>
    </Suspense>
  )
}
