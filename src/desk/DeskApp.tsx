/** The desk view's routes (mounted at /desk/*). Each page loads on first visit. */
import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router";
import DeskShell from "./DeskShell";
import { Notice, Shimmer } from "./components";

const Today = lazy(() => import("./pages/Today"));
const Markets = lazy(() => import("./pages/Markets"));
const Screener = lazy(() => import("./pages/Screener"));
const CompanyPage = lazy(() => import("./pages/Company"));
const Research = lazy(() => import("./pages/Research"));
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
          <Route path="research" element={<Research />} />
          <Route path="operations" element={<Operations />} />
          <Route path="*" element={<DeskNotFound />} />
        </Routes>
      </Suspense>
    </DeskShell>
  );
}
