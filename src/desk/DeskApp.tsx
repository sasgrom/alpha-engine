/** The desk view's routes (mounted at /desk/*). Each page loads on first visit. */
import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router";
import DeskShell from "./DeskShell";
import { Notice, Shimmer } from "./components";

const Today = lazy(() => import("./pages/Today"));
const Markets = lazy(() => import("./pages/Markets"));
const Screener = lazy(() => import("./pages/Screener"));
const CompanyPage = lazy(() => import("./pages/Company"));
const Signals = lazy(() => import("./pages/research/Signals"));
const Earnings = lazy(() => import("./pages/research/Earnings"));
const Volatility = lazy(() => import("./pages/research/Volatility"));
const Macro = lazy(() => import("./pages/research/Macro"));
const Ownership = lazy(() => import("./pages/research/Ownership"));
const Library = lazy(() => import("./pages/research/Library"));
const Flows = lazy(() => import("./flows/FlowsPage"));
const Engine = lazy(() => import("./engine/EnginePage"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const Operations = lazy(() => import("./pages/Operations"));

function DeskNotFound() {
  return (
    <Notice title="This page does not exist">
      <Link className="desk-link" to="/desk">Back to Today</Link>
    </Notice>
  );
}

export default function DeskApp() {
  return (
    <DeskShell>
      <Suspense fallback={<Shimmer height={420} />}>
        <Routes>
          <Route index element={<Today />} />
          <Route path="markets" element={<Markets />} />
          <Route path="screener" element={<Screener />} />
          <Route path="company/:ticker" element={<CompanyPage />} />
          <Route path="research" element={<Signals />} />
          <Route path="research/earnings" element={<Earnings />} />
          <Route path="research/volatility" element={<Volatility />} />
          <Route path="research/macro" element={<Macro />} />
          <Route path="research/ownership" element={<Ownership />} />
          <Route path="research/library" element={<Library />} />
          <Route path="flows" element={<Flows />} />
          <Route path="engine" element={<Engine />} />
          <Route path="watchlist" element={<Watchlist />} />
          <Route path="operations" element={<Operations />} />
          <Route path="*" element={<DeskNotFound />} />
        </Routes>
      </Suspense>
    </DeskShell>
  );
}
