import { useState } from "react";
import { KeyRound, RotateCcw, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { jobToast } from "@/lib/job-toast";

const timeText = (value: unknown) => value ? String(value).slice(0, 19).replace("T", " ") : "—";

export default function ReviewerAdminTab() {
  const utils = trpc.useUtils();
  const list = trpc.admin.reviewerList.useQuery(undefined, { retry: false });
  const [form, setForm] = useState({ username: "", password: "", name: "" });
  const invalidate = () => { utils.admin.reviewerList.invalidate(); utils.admin.usersList.invalidate(); };
  const ok = (what: string) => ({
    onSuccess: () => { invalidate(); jobToast("success", what, ""); },
    onError: (e: { message: string }) => jobToast("error", `${what} failed`, e.message),
  });
  const create = trpc.admin.createReviewer.useMutation(ok("Reviewer created"));
  const resetIp = trpc.admin.resetReviewerFirstIp.useMutation(ok("First-IP and NDA reset"));
  const resetNda = trpc.admin.resetReviewerNda.useMutation(ok("NDA reset"));
  const resetTour = trpc.admin.resetReviewerTour.useMutation(ok("Tour reset"));
  const deleteUser = trpc.admin.deleteUser.useMutation(ok("Reviewer deleted"));

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="t-label mb-3 flex items-center gap-2"><UserPlus size={12} /> Create reviewer</div>
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Reviewer username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="username" className="h-8 w-40 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]" />
          <Input aria-label="Reviewer password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="password" className="h-8 w-40 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]" />
          <Input aria-label="Reviewer display name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="display name (optional)" className="h-8 w-48 t-mono text-[11px] bg-[hsl(var(--secondary)/0.5)]" />
          <Button size="sm" disabled={!form.username || !form.password || create.isPending} onClick={() => create.mutate({ username: form.username.trim(), password: form.password, name: form.name.trim() || undefined })}>
            <UserPlus size={12} /> Create
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">Creates a read-only reviewer with NDA, first-IP binding, two guided tours and a 50-company presentation universe. Credentials are not returned by the API.</p>
      </div>

      <div className="panel p-4 overflow-auto">
        <div className="t-label mb-3 flex items-center gap-2"><ShieldCheck size={12} /> Reviewer profiles</div>
        <table className="w-full text-left border-collapse">
          <thead><tr className="border-b border-[hsl(var(--border))]">
            <th className="px-3 py-2 t-mono text-[10px] text-muted-foreground">User</th><th className="px-3 py-2 t-mono text-[10px] text-muted-foreground">NDA</th><th className="px-3 py-2 t-mono text-[10px] text-muted-foreground">First IP</th><th className="px-3 py-2 t-mono text-[10px] text-muted-foreground">Universe</th><th className="px-3 py-2 t-mono text-[10px] text-muted-foreground">Tours</th><th className="px-3 py-2 t-mono text-[10px] text-muted-foreground">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-[hsl(var(--border)/0.6)]">
            {(list.data ?? []).map((profile) => (
              <tr key={profile.userId} className="align-top">
                <td className="px-3 py-2"><div className="t-mono text-[11px] text-[hsl(var(--live))]">{profile.username ?? "—"}</div><div className="text-[11px] text-muted-foreground">{profile.name ?? "—"}</div></td>
                <td className="px-3 py-2 t-mono text-[10px]">{profile.ndaAccepted ? `accepted ${timeText(profile.acceptedAt)}` : "pending"}</td>
                <td className="px-3 py-2 t-mono text-[10px]">{profile.firstIpBound ? "bound" : "pending"}</td>
                <td className="px-3 py-2 t-mono text-[10px]">{profile.universeSize}</td>
                <td className="px-3 py-2 t-mono text-[10px]">{profile.tours.map((tour) => `${tour.track === "geography" ? "geo" : "tech"} ${tour.currentStep}/${tour.status}`).join(" · ")}</td>
                <td className="px-3 py-2"><div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => resetIp.mutate({ userId: profile.userId })}><RotateCcw size={11} /> Reset IP+NDA</Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => resetNda.mutate({ userId: profile.userId })}><KeyRound size={11} /> Reset NDA</Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => resetTour.mutate({ userId: profile.userId })}><RotateCcw size={11} /> Reset tour</Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] text-crit-red" onClick={() => {
                    if (window.confirm(`Delete reviewer ${profile.username ?? profile.userId}? The account, tours and presentation universe are removed too.`)) {
                      deleteUser.mutate({ userId: profile.userId });
                    }
                  }}><Trash2 size={11} /> Delete</Button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.data?.length && <div className="t-mono text-[11px] text-muted-foreground">No reviewer profiles yet.</div>}
      </div>
    </div>
  );
}
