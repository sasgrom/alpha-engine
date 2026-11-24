import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation, useParams } from "react-router";
import ReviewerGate from "./components/ReviewerGate";

const Desk = lazy(() => import("./desk/DeskApp"));
const SignIn = lazy(() => import("./desk/pages/SignIn"));

/** The classic view is gone (2026-11-24). Its addresses stay alive as redirects to the desk page that took each over. */
const MOVED: Record<string, string> = {
  "/terminal": "/desk",
  "/dashboard": "/desk",
  "/screener": "/desk/screener",
  "/universe": "/desk/watchlist",
  "/messages": "/desk/messages",
  "/admin": "/desk/admin",
  "/workers": "/desk/operations?tab=jobs",
  "/jobs": "/desk/operations?tab=runs",
  "/project-state": "/desk/operations",
  "/database": "/desk/operations",
  "/lab": "/desk/research",
  "/analytics": "/desk/research",
  "/analytics/methodology": "/desk/research/library/volatility-handbook",
  "/analytics/risk-lab": "/desk/research/volatility",
  "/market-data": "/desk/research/volatility",
  "/scenario-lab": "/desk/research/macro?view=scenarios",
  "/expectations": "/desk/research/guidance",
  "/insider-activity": "/desk/research/ownership",
};

function CompanyRedirect() {
  const { ticker } = useParams();
  return <Navigate to={`/desk/company/${encodeURIComponent(ticker ?? "")}`} replace />;
}

function FactorWikiRedirect() {
  const { hash } = useLocation();
  return <Navigate to={{ pathname: "/desk/research/library/factors", hash }} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh" }} aria-hidden="true" />}>
      <ReviewerGate><Routes>
      <Route path="/" element={<Navigate to="/desk" replace />} />
      <Route path="/desk/*" element={<Desk />} />
      <Route path="/login" element={<SignIn mode="signin" />} />
      <Route path="/signup" element={<SignIn mode="signup" />} />
      {Object.entries(MOVED).map(([from, to]) => <Route key={from} path={from} element={<Navigate to={to} replace />} />)}
      <Route path="/company/:ticker" element={<CompanyRedirect />} />
      <Route path="/wiki" element={<FactorWikiRedirect />} />
      {/* any other address opens the desk; a wrong page inside the desk says so itself */}
      <Route path="*" element={<Navigate to="/desk" replace />} />
      </Routes></ReviewerGate>
    </Suspense>
  );
}
