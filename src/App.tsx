import { Routes, Route, Link } from 'react-router'
import type { ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Universe from './pages/Universe'
import Company from './pages/Company'
import Jobs from './pages/Jobs'
import Screener from './pages/Screener'
import DatabasePage from './pages/Database'
import Lab from './pages/Lab'
import Admin from './pages/Admin'
import Workers from './pages/Workers'
import Messages from './pages/Messages'
import Login from "./pages/Login"
import Signup from "./pages/Signup"
import Wiki from "./pages/Wiki"
import NotFound from "./pages/NotFound"
import { useAuth } from "@/hooks/useAuth"

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
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
