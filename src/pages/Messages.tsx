/**
 * /messages — messenger (4e, D34): contact list + pairwise DMs.
 *
 * Left pane: CONTACTS — every other user (admins first), searchable by
 * name/username, with unread badges and last-activity markers. Clicking a
 * contact opens the conversation; the composer writes into it. For the
 * admin each contact carries an info button → per-user summary + activity
 * log (D35). Honesty note for users: admins can read threads (moderation).
 *
 * Delivery: 8 s polling, markRead on view (React Query v5 — effect on data).
 */
import { useEffect, useRef, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, MessageSquare, Search, Info, X, ChevronLeft } from "lucide-react";
import { jobToast } from "@/lib/job-toast";

const fmtTs = (v: string | Date | null | undefined) => (v ? String(v).slice(5, 16).replace("T", " ") : "—");

/** Admin info panel (D35): summary counters + the recent activity log. */
function UserInfoPanel({ userId, onClose }: { userId: number; onClose: () => void }) {
  const sum = trpc.admin.userSummary.useQuery({ userId });
  const acts = trpc.admin.userActivity.useQuery({ userId, limit: 30 });
  const s = sum.data;
  return (
    <div className="t-panel p-4 w-full md:w-[320px] shrink-0 max-h-[70vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <span className="t-label">User intel</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
      </div>
      {s && (
        <>
          <div className="t-mono text-[12px] text-[hsl(var(--live))]">{s.user.username ?? "?"}</div>
          <div className="text-[11px] text-muted-foreground mb-3">{s.user.name ?? ""} · {s.user.role}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3">
            {[
              ["Universe", `${s.universeActive} active / ${s.universeSize}`],
              ["Messages sent", s.messagesSent],
              ["Jobs launched", s.jobsLaunched],
              ["Logins (7d)", s.activity.logins7d],
              ["Pages (24h)", s.activity.pages24h],
              ["Events total", s.activity.totalEvents],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <div className="t-label !text-[9px]">{k}</div>
                <div className="t-mono text-[12px] mt-0.5">{String(v)}</div>
              </div>
            ))}
          </div>
          <div className="t-mono text-[9px] text-muted-foreground space-y-1 mb-3 uppercase">
            <div>last login: {fmtTs(s.activity.lastLoginAt)}</div>
            <div>last seen: {fmtTs(s.activity.lastSeenAt)}</div>
            <div>joined: {String(s.user.createdAt).slice(0, 10)}</div>
          </div>
          <div className="t-label !text-[9px] mb-1.5 border-t border-border pt-2">Activity log</div>
          <div className="space-y-1">
            {(acts.data ?? []).map((a) => (
              <div key={a.id} className="t-mono text-[9px] text-muted-foreground flex gap-2">
                <span className="shrink-0 opacity-60">{String(a.createdAt).slice(5, 16).replace("T", " ")}</span>
                <span className={a.type === "page" ? "" : "text-[hsl(var(--live))]"}>
                  {a.type}{a.path ? ` ${a.path}` : ""}
                </span>
              </div>
            ))}
            {acts.data?.length === 0 && <div className="t-mono text-[9px] text-muted-foreground">no events yet</div>}
          </div>
        </>
      )}
    </div>
  );
}

/** One conversation pane: bubbles (mine right / peer left) + composer. */
function Thread({ withUserId, peerLabel, onBack }: { withUserId: number; peerLabel: string; onBack?: () => void }) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const list = trpc.messages.list.useQuery({ withUserId }, { refetchInterval: 8000 });
  const markRead = trpc.messages.markRead.useMutation({
    onSuccess: () => {
      utils.messages.unreadCount.invalidate();
      utils.messages.contacts.invalidate();
    },
  });
  const send = trpc.messages.send.useMutation({
    onSuccess: () => {
      setDraft("");
      utils.messages.list.invalidate();
      utils.messages.contacts.invalidate();
    },
    onError: (e) => jobToast("error", "Message not sent", e.message),
  });

  const rows = list.data?.rows ?? [];
  const me = trpc.auth.me.useQuery(undefined, { staleTime: 60_000 }).data;
  // viewing reads the peer's messages (their side of the conv)
  useEffect(() => {
    if (me && rows.some((m) => m.readAt === null && m.recipientId === me.id)) {
      markRead.mutate({ withUserId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [rows.length]);

  const submit = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    send.mutate({ body, toUserId: withUserId });
  };

  return (
    <div className="t-panel flex flex-col h-[70vh]">
      <div className="px-4 py-2.5 border-b border-border t-label flex items-center gap-2">
        {/* 4g: on phones the thread replaces the contact list — back returns */}
        {onBack && (
          <button onClick={onBack} className="md:hidden text-muted-foreground hover:text-foreground -ml-1" aria-label="Back to contacts">
            <ChevronLeft size={16} />
          </button>
        )}
        <MessageSquare size={12} className="text-[hsl(var(--live))]" /> {peerLabel}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {rows.length === 0 && (
          <div className="t-mono text-[11px] text-muted-foreground text-center pt-16">NO MESSAGES YET — SAY HI</div>
        )}
        {rows.map((m) => {
          const mine = me && m.authorId === me.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[70%] px-3 py-2 rounded-lg text-[12px] leading-relaxed whitespace-pre-wrap ${
                  mine
                    ? "bg-[hsl(var(--live)/0.12)] border border-[hsl(var(--live)/0.3)]"
                    : "bg-[hsl(var(--accent)/0.4)] border border-border"
                }`}
              >
                {m.body}
                <div className="t-mono text-[9px] text-muted-foreground mt-1 text-right">
                  {fmtTs(m.createdAt)}
                  {mine && m.readAt && " · read"}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="px-3 py-2.5 border-t border-border flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={`Message ${peerLabel.toLowerCase()}…`}
          maxLength={2000}
          className="h-9 t-mono text-[12px] bg-[hsl(var(--secondary)/0.5)]"
        />
        <Button
          size="sm"
          className="h-9 px-3 bg-[hsl(var(--live))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--live)/0.85)]"
          onClick={submit}
          disabled={send.isPending || !draft.trim()}
        >
          <Send size={13} />
        </Button>
      </div>
    </div>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [openWith, setOpenWith] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [infoFor, setInfoFor] = useState<number | null>(null);

  const contacts = trpc.messages.contacts.useQuery(undefined, { refetchInterval: 8000 });
  const list = contacts.data ?? [];
  const filtered = q.trim()
    ? list.filter((c) =>
        `${c.username ?? ""} ${c.name ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())
      )
    : list;
  const open = list.find((c) => c.id === openWith);

  return (
    <AppLayout title="Messages">
      {/* 4g: on phones this is single-pane — contacts OR the open thread */}
      <div className="flex flex-col md:flex-row gap-4 max-w-[1100px]">
        {/* contacts */}
        <div className={`t-panel overflow-hidden w-full md:w-[300px] shrink-0 ${openWith !== null ? "hidden md:block" : ""}`}>
          <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
            <Search size={12} className="text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="SEARCH CONTACTS"
              className="w-full bg-transparent outline-none t-mono text-[10px] uppercase placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="divide-y divide-[hsl(var(--border)/0.6)] max-h-[66vh] overflow-y-auto">
            {filtered.map((c) => (
              <div
                key={c.id}
                className={`w-full flex items-center gap-1 px-3 py-2.5 transition-colors cursor-pointer ${
                  openWith === c.id ? "bg-[hsl(var(--accent)/0.35)]" : "hover:bg-[hsl(var(--accent)/0.15)]"
                }`}
                onClick={() => setOpenWith(c.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="t-mono text-[11px] font-semibold truncate">{c.name ?? c.username}</span>
                    {c.role === "admin" && (
                      <span className="t-mono text-[8px] px-1 py-0.5 rounded border border-[hsl(var(--warn)/0.4)] text-[hsl(var(--warn))]">ADMIN</span>
                    )}
                  </div>
                  <div className="t-mono text-[9px] text-muted-foreground truncate">
                    @{c.username} · {c.lastActivityAt ? `seen ${fmtTs(c.lastActivityAt)}` : "no activity yet"}
                  </div>
                </div>
                {isAdmin && (
                  <button
                    title="User intel (activity + counters)"
                    className="text-muted-foreground hover:text-[hsl(var(--live))] shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setInfoFor(infoFor === c.id ? null : c.id);
                    }}
                  >
                    <Info size={13} />
                  </button>
                )}
                {c.unread > 0 && (
                  <span className="t-mono text-[9px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--live))] text-[hsl(var(--primary-foreground))] shrink-0">
                    {c.unread}
                  </span>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-4 py-10 text-center t-mono text-[11px] text-muted-foreground">
                {list.length === 0 ? "NO OTHER USERS YET" : "NO CONTACT MATCHES"}
              </div>
            )}
          </div>
        </div>

        {/* conversation */}
        <div className={`flex-1 min-w-0 ${openWith === null ? "hidden md:block" : ""}`}>
          {openWith !== null ? (
            <Thread withUserId={openWith} peerLabel={(open?.name ?? open?.username ?? `user ${openWith}`).toUpperCase()} onBack={() => setOpenWith(null)} />
          ) : (
            <div className="t-panel h-[70vh] flex items-center justify-center t-mono text-[11px] text-muted-foreground">
              SELECT A CONTACT
            </div>
          )}
          <div className="t-mono text-[8px] text-muted-foreground/60 mt-2 uppercase tracking-[0.08em]">
            admins can read threads for moderation · messages are stored, not end-to-end encrypted
          </div>
        </div>

        {/* admin info panel */}
        {isAdmin && infoFor !== null && <UserInfoPanel userId={infoFor} onClose={() => setInfoFor(null)} />}
      </div>
    </AppLayout>
  );
}
