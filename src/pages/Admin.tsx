/**
 * /admin — the platform owner's service section (iteration 3b/3c).
 *
 * Visibility: the menu item renders only when user.role === "admin"
 * (AppLayout), and the API is additionally guarded by adminQuery — a
 * non-admin gets FORBIDDEN even on a direct URL visit (shown explicitly
 * below instead of a blank screen).
 *
 * Three tabs:
 *   Manuals — the project's living manuals (ALPHA_ENGINE_MANUAL EN/RU,
 *             LLM_CONTEXT). Served disk-first with a bundled fallback, so
 *             they load in any runtime. Rendered as mono pre-wrap: the
 *             manuals are markdown, but raw view is enough for the owner
 *             (no heavy md renderer dependency).
 *   Logs    — full log of any job (the Jobs page shows only a tail).
 *   Tools   — entry points to the owner instruments hidden from the user
 *             nav: Database browser and Sentiment Lab.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { trpc, VIEW_AS_KEY } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldAlert, Database, FlaskConical, UserPlus, Trash2, KeyRound, ArrowUpDown, Eye } from "lucide-react";
import { describeJob } from "@/lib/job-describe";
import { jobToast } from "@/lib/job-toast";
import { PriceImportCard } from "@/components/PriceImportCard";

type ManualId = "engine-manual-en" | "engine-manual-ru" | "llm-context" | "design-value-signals";

/**
 * Users tab (4d, D33) — account management for the local auth: create local
 * accounts (admin-chosen passwords skip the public policy), delete (cascades
 * only per-user artifacts), reset passwords, promote/demote. The admin
 * cannot delete or demote HIMSELF (lockout prevention, server-enforced too).
 */
function UsersTab({ selfId }: { selfId: number | null }) {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const list = trpc.admin.usersList.useQuery(undefined, { retry: false });
  const [nu, setNu] = useState({ username: "", password: "", name: "", role: "user" as "user" | "admin" });

  const ok = (what: string) => ({
    onSuccess: () => {
      utils.admin.usersList.invalidate();
      jobToast("success", what, "");
    },
    onError: (e: { message: string }) => jobToast("error", `${what} failed`, e.message),
  });
  const createUser = trpc.admin.createUser.useMutation(ok("User created"));
  const deleteUser = trpc.admin.deleteUser.useMutation(ok("User deleted"));
  const resetPassword = trpc.admin.resetPassword.useMutation(ok("Password reset"));
  const setUserRole = trpc.admin.setUserRole.useMutation(ok("Role updated"));

  return (
    <div className="space-y-4">
      {/* create */}
      <div className="panel p-4">
        <div className="t-label mb-3 flex items-center gap-2"><UserPlus size={12} /> Create account</div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} placeholder="username"
            className="h-8 w-40 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]" />
          <Input value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="password"
            className="h-8 w-40 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]" />
          <Input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="display name (optional)"
            className="h-8 w-48 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]" />
          <Select value={nu.role} onValueChange={(v) => setNu({ ...nu, role: v as "user" | "admin" })}>
            <SelectTrigger className="h-8 w-28 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="user">user</SelectItem>
              <SelectItem value="admin">admin</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-8 t-mono text-[10px] bg-[hsl(var(--live))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--live)/0.85)]"
            disabled={!nu.username || !nu.password || createUser.isPending}
            onClick={() => createUser.mutate({ username: nu.username.trim(), password: nu.password, name: nu.name.trim() || undefined, role: nu.role })}
          >
            Create
          </Button>
        </div>
        <div className="t-mono text-[9px] text-muted-foreground mt-2 uppercase tracking-[0.08em]">
          admin-chosen passwords skip the public signup policy · new accounts start with an empty universe
        </div>
      </div>

      {/* list — 4g: horizontal scroll on small screens */}
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead>
            <tr className="border-b border-border">
              {["ID", "Username", "Name", "Role", "Universe", "Last sign-in", "Created", ""].map((h) => (
                <th key={h} className="t-label text-left px-3 py-2 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border)/0.6)]">
            {(list.data ?? []).map((u) => (
              <tr key={u.id} className="hover:bg-[hsl(var(--accent)/0.15)]">
                <td className="px-3 py-2 t-mono text-[10px] text-muted-foreground">{u.id}</td>
                <td className="px-3 py-2 t-mono text-[11px] text-[hsl(var(--live))]">{u.username ?? "—"}</td>
                <td className="px-3 py-2 text-[11px]">{u.name ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={`t-mono text-[9px] px-1.5 py-0.5 border rounded-sm ${
                    u.role === "admin" ? "text-[hsl(var(--warn))] border-[hsl(var(--warn)/0.4)]" : "text-muted-foreground border-border"
                  }`}>
                    {u.role.toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2 t-mono text-[11px]">{u.universeSize}</td>
                <td className="px-3 py-2 t-mono text-[10px] text-muted-foreground">{String(u.lastSignInAt).slice(0, 16).replace("T", " ")}</td>
                <td className="px-3 py-2 t-mono text-[10px] text-muted-foreground">{String(u.createdAt).slice(0, 10)}</td>
                <td className="px-3 py-2">
                  {u.id !== selfId && (
                    <span className="flex items-center gap-1.5 justify-end">
                      {/* 4e (D36): the read-only view-as lens — the app renders
                          exactly what this user sees; writes stay blocked */}
                      <button
                        title="View the app as this user (read-only)"
                        className="text-muted-foreground hover:text-[hsl(var(--warn))] transition-colors"
                        onClick={() => {
                          localStorage.setItem(VIEW_AS_KEY, String(u.id));
                          window.dispatchEvent(new Event("alpha-viewas-changed"));
                          void utils.invalidate();
                          navigate("/");
                        }}
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        title="Reset password"
                        className="text-muted-foreground hover:text-[hsl(var(--live))] transition-colors"
                        onClick={() => {
                          const pw = window.prompt(`New password for ${u.username ?? u.id}:`);
                          if (pw) resetPassword.mutate({ userId: u.id, password: pw });
                        }}
                      >
                        <KeyRound size={13} />
                      </button>
                      <button
                        title={u.role === "admin" ? "Demote to user" : "Promote to admin"}
                        className="text-muted-foreground hover:text-[hsl(var(--warn))] transition-colors"
                        onClick={() => setUserRole.mutate({ userId: u.id, role: u.role === "admin" ? "user" : "admin" })}
                      >
                        <ArrowUpDown size={13} />
                      </button>
                      <button
                        title="Delete account (memberships + messages go with it; shared data untouched)"
                        className="text-muted-foreground hover:text-[hsl(var(--crit))] transition-colors"
                        onClick={() => {
                          if (window.confirm(`Delete ${u.username ?? `user ${u.id}`}? Their universe and messages are removed too.`))
                            deleteUser.mutate({ userId: u.id });
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Admin() {
  // retry: false — otherwise a non-admin stares at "loading…" during retries
  // instead of the FORBIDDEN screen
  const { user } = useAuth();
  const manuals = trpc.admin.manuals.useQuery(undefined, { retry: false });
  const [manualId, setManualId] = useState<ManualId>("engine-manual-en");
  const content = trpc.admin.manualContent.useQuery(
    { id: manualId },
    { enabled: !manuals.isError, retry: false }
  );

  const recentJobs = trpc.admin.recentJobs.useQuery(undefined, { retry: false });
  const [jobId, setJobId] = useState<number | null>(null);
  const jobLog = trpc.admin.jobLog.useQuery({ jobId: jobId ?? 0 }, { enabled: jobId !== null });

  // API returned FORBIDDEN — the visitor is not the owner. An explicit
  // message instead of an empty page.
  if (manuals.isError) {
    return (
      <AppLayout title="Admin">
        <div className="p-8 flex items-center gap-3 text-crit-red">
          <ShieldAlert size={16} />
          <span className="t-mono text-[12px]">admin section — insufficient role ({manuals.error.message})</span>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Admin">
    <div className="p-6 max-w-[1100px]">
      <div className="mb-4">
        <div className="t-label">OWNER ONLY</div>
        <h1 className="t-mono text-[18px] font-semibold">Admin</h1>
        <p className="text-[12px] text-muted-foreground mt-1">
          Living manuals, full pipeline logs and owner instruments. Invisible to role="user" accounts.
        </p>
      </div>

      <Tabs defaultValue="manuals">
        <TabsList className="t-mono text-[11px]">
          <TabsTrigger value="manuals">Manuals</TabsTrigger>
          <TabsTrigger value="logs">Job Logs</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <UsersTab selfId={user?.id ?? null} />
        </TabsContent>

        <TabsContent value="manuals" className="mt-4">
          {/* manual switcher: chips; the content badge says disk vs bundled */}
          <div className="flex gap-2 mb-3">
            {(manuals.data ?? []).map((m) => (
              <button
                key={m.id}
                onClick={() => setManualId(m.id)}
                className={`t-mono text-[11px] px-3 py-1.5 border rounded-sm transition-colors ${
                  manualId === m.id
                    ? "border-live-cyan text-live-cyan"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.title}
              </button>
            ))}
          </div>
          <div className="panel p-4 max-h-[75vh] overflow-auto">
            {content.isLoading && <div className="t-mono text-[11px] text-muted-foreground">loading…</div>}
            {content.isError && (
              <div className="t-mono text-[11px] text-crit-red">failed: {content.error.message}</div>
            )}
            {content.data && (
              <>
                <div className="t-mono text-[9px] text-muted-foreground mb-2 uppercase">
                  {content.data.title} · source: {content.data.source} · updated {String(content.data.updatedAt).slice(0, 10)}
                </div>
                <pre className="t-mono text-[11px] leading-relaxed whitespace-pre-wrap">{content.data.content}</pre>
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            {/* recent jobs across ALL users; click loads the full log on the right */}
            <div className="panel p-2 max-h-[75vh] overflow-auto">
              {(recentJobs.data ?? []).map((j) => {
                const desc = describeJob(j.type, j.params);
                return (
                  <button
                    key={j.id}
                    onClick={() => setJobId(j.id)}
                    className={`w-full text-left px-2 py-1.5 rounded-sm t-mono text-[10px] transition-colors ${
                      jobId === j.id ? "bg-accent text-live-cyan" : "text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    <div>
                      #{j.id} {j.type} ·{" "}
                      <span className={j.status === "error" ? "text-crit-red" : j.status === "done" ? "text-live-cyan" : "text-warn-amber"}>
                        {j.status}
                      </span>
                      <span className="opacity-60"> · by {j.startedByName ?? (j.startedBy ? `user ${j.startedBy}` : "legacy")}</span>
                    </div>
                    {desc && <div className="opacity-70 truncate">{desc}</div>}
                    <div className="opacity-60">{String(j.createdAt).slice(0, 19)}</div>
                  </button>
                );
              })}
            </div>
            <div className="panel p-3 max-h-[75vh] overflow-auto">
              {jobId === null && (
                <div className="t-mono text-[11px] text-muted-foreground">select a job on the left</div>
              )}
              {jobLog.data?.truncated && (
                <div className="t-mono text-[10px] text-warn-amber mb-2">
                  log truncated to first 2000 lines
                </div>
              )}
              {jobLog.data?.lines.map((l) => (
                <div key={l.id} className="t-mono text-[10px] leading-relaxed">
                  <span className="text-muted-foreground">{String(l.ts).slice(11, 19)} </span>
                  <span className={l.level === "error" ? "text-crit-red" : l.level === "warn" ? "text-warn-amber" : "text-foreground"}>
                    [{l.level}]
                  </span>{" "}
                  {l.message}
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          {/* owner instruments removed from the user-facing nav (declutter, 3c) */}
          <div className="grid sm:grid-cols-2 gap-4 max-w-[720px]">
            <Link to="/database" className="panel p-4 block hover:border-live-cyan transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <Database size={14} className="text-live-cyan" />
                <span className="t-mono text-[12px] font-semibold">Database browser</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Raw filings, documents, facts and scores straight from MySQL. Owner diagnostics.
              </p>
            </Link>
            <Link to="/lab" className="panel p-4 block hover:border-live-cyan transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <FlaskConical size={14} className="text-live-cyan" />
                <span className="t-mono text-[12px] font-semibold">Sentiment Lab</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Scoring coverage, rubric quality and signal validation (IC / Spearman). Owner R&amp;D.
              </p>
            </Link>
            {/* Stage 1.7 (3g): chunked upload of the Stooq bulk zip + import launch */}
            <PriceImportCard />
          </div>
        </TabsContent>
      </Tabs>
    </div>
    </AppLayout>
  );
}
