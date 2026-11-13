import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router";
import { ChevronLeft, Info, MessageSquare, Search, Send, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useReviewer } from "@/hooks/useReviewer";
import { trpc } from "@/providers/trpc";
import { Card, Notice, Shimmer } from "../components";
import { useDesk, useDocumentTitle } from "../context";
import { DevNotes } from "../DevNotes";

interface Contact {
  id: number;
  username: string | null;
  name: string | null;
  unread: number;
  lastMsgAt: string | null;
  role?: "user" | "admin";
  lastSignInAt?: string | null;
  lastActivityAt?: string | null;
}

const contactName = (contact: Contact | undefined, id: number) => contact?.name ?? contact?.username ?? `Account ${id}`;
const timeText = (value: unknown) => value ? String(value).slice(5, 16).replace("T", " ") : "—";

function UserIntel({ userId, onClose }: { userId: number; onClose: () => void }) {
  const summary = trpc.admin.userSummary.useQuery({ userId });
  const activity = trpc.admin.userActivity.useQuery({ userId, limit: 30 });
  const data = summary.data;
  return (
    <aside className="desk-intel" aria-label="User intel">
      <div className="desk-intel-head"><strong>User intel</strong><button type="button" className="desk-icon-button" aria-label="Close user intel" onClick={onClose}><X size={15} /></button></div>
      {summary.isLoading && <Shimmer height={150} />}
      {data && (
        <>
          <h3>{data.user.name ?? data.user.username}</h3>
          <p className="desk-muted">@{data.user.username} · {data.user.role}</p>
          <dl className="desk-intel-stats">
            <div><dt>Universe</dt><dd>{data.universeActive} active / {data.universeSize}</dd></div>
            <div><dt>Messages sent</dt><dd>{data.messagesSent}</dd></div>
            <div><dt>Jobs launched</dt><dd>{data.jobsLaunched}</dd></div>
            <div><dt>Logins · 7d</dt><dd>{data.activity.logins7d}</dd></div>
            <div><dt>Pages · 24h</dt><dd>{data.activity.pages24h}</dd></div>
            <div><dt>Events total</dt><dd>{data.activity.totalEvents}</dd></div>
          </dl>
          <p className="desk-muted desk-intel-times">Last login {timeText(data.activity.lastLoginAt)}<br />Last seen {timeText(data.activity.lastSeenAt)}<br />Joined {timeText(data.user.createdAt)}</p>
        </>
      )}
      <h4>Recent activity</h4>
      <div className="desk-activity-list">
        {(activity.data ?? []).map((event) => <div key={event.id}><span>{timeText(event.createdAt)}</span> {event.type}{event.path ? ` ${event.path}` : ""}</div>)}
        {activity.data?.length === 0 && <p className="desk-empty">No activity recorded.</p>}
      </div>
    </aside>
  );
}

function Thread({ contact, visible, onBack }: { contact: Contact; visible: boolean; onBack: () => void }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const list = trpc.messages.list.useQuery({ withUserId: contact.id }, { enabled: visible, refetchInterval: visible ? 8000 : false, refetchIntervalInBackground: false });
  const markRead = trpc.messages.markRead.useMutation({
    onSuccess: () => {
      void utils.messages.unreadCount.invalidate();
      void utils.messages.contacts.invalidate();
    },
  });
  const send = trpc.messages.send.useMutation({
    onSuccess: () => {
      setDraft("");
      void utils.messages.list.invalidate();
      void utils.messages.contacts.invalidate();
    },
  });
  const rows = list.data?.rows ?? [];
  useEffect(() => {
    if (user && rows.some((row) => row.recipientId === user.id && row.readAt === null)) markRead.mutate({ withUserId: contact.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, user?.id, contact.id]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [rows.length]);

  const submit = () => {
    const body = draft.trim();
    if (body && !send.isPending) send.mutate({ toUserId: contact.id, body });
  };

  return (
    <Card className="desk-thread" flush>
      <div className="desk-thread-head">
        <button type="button" className="desk-icon-button desk-thread-back" aria-label="Back to conversations" onClick={onBack}><ChevronLeft size={17} /></button>
        <MessageSquare size={16} aria-hidden="true" />
        <strong>{contactName(contact, contact.id)}</strong>
        <span className="desk-muted">@{contact.username ?? contact.id}</span>
      </div>
      <div className="desk-thread-body" aria-live="polite">
        {list.isLoading && <Shimmer height={160} />}
        {list.error && <Notice title="The conversation could not be loaded">{list.error.message}</Notice>}
        {!list.isLoading && rows.length === 0 && <div className="desk-empty">No messages yet. Start the conversation.</div>}
        {rows.map((message) => {
          const mine = message.authorId === user?.id;
          return (
            <div key={message.id} className={`desk-message${mine ? " mine" : ""}`}>
              <div className="desk-message-bubble">
                <p>{message.body}</p>
                <small>{timeText(message.createdAt)}{mine && message.readAt ? " · read" : ""}</small>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <div className="desk-composer">
        <textarea aria-label="Message" value={draft} maxLength={2000} rows={2} placeholder={`Message ${contactName(contact, contact.id)}…`} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }} />
        <div><span className="desk-muted">{draft.length} / 2,000</span><button type="button" className="desk-button primary" disabled={!draft.trim() || send.isPending} onClick={submit}><Send size={14} /> Send</button></div>
        {send.error && <p className="desk-form-error" role="alert">{send.error.message}</p>}
      </div>
    </Card>
  );
}

export default function Messages() {
  useDocumentTitle("Messages");
  const { isAdmin } = useDesk();
  const reviewer = useReviewer();
  const [visible, setVisible] = useState(typeof document === "undefined" || !document.hidden);
  const [selected, setSelected] = useState<number | null>(null);
  const [infoFor, setInfoFor] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const contactsQuery = trpc.messages.contacts.useQuery(undefined, { enabled: visible && !reviewer.status.data?.isReviewer, refetchInterval: visible ? 8000 : false, refetchIntervalInBackground: false });
  const contacts = useMemo(() => [...((contactsQuery.data ?? []) as Contact[])].sort((a, b) => b.unread - a.unread || String(b.lastMsgAt ?? "").localeCompare(String(a.lastMsgAt ?? "")) || contactName(a, a.id).localeCompare(contactName(b, b.id))), [contactsQuery.data]);
  const filtered = contacts.filter((contact) => `${contact.name ?? ""} ${contact.username ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    if (selected === null && contacts.length) setSelected(contacts[0].id);
    if (selected !== null && !contacts.some((contact) => contact.id === selected)) setSelected(null);
  }, [contacts, selected]);
  const open = contacts.find((contact) => contact.id === selected);

  if (reviewer.status.data?.isReviewer) return <Navigate to="/desk" replace />;
  return (
    <div>
      <div className="desk-page-head">
        <div><span className="desk-eyebrow">Workspace</span><h1>Messages</h1><p className="desk-lede">Conversations with the team, unread first. Messages are stored, not end-to-end encrypted.</p></div>
      </div>
      <div className={`desk-messages-layout${open ? " thread-open" : ""}${infoFor !== null ? " with-intel" : ""}`}>
        <Card flush className="desk-contact-card">
          <div className="desk-contact-search"><Search size={15} aria-hidden="true" /><input aria-label="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" /></div>
          <div className="desk-contact-list">
            {contactsQuery.isLoading && <Shimmer height={180} />}
            {contactsQuery.error && <Notice title="Contacts could not be loaded">{contactsQuery.error.message}</Notice>}
            {!contactsQuery.isLoading && filtered.length === 0 && <div className="desk-empty">{contacts.length ? "No contacts match your search." : "No conversations or admins available."}</div>}
            {filtered.map((contact) => (
              <div key={contact.id} className={`desk-contact${selected === contact.id ? " selected" : ""}`}>
                <button type="button" className="desk-contact-main" onClick={() => { setSelected(contact.id); setInfoFor(null); }}>
                  <span className="desk-contact-name"><strong>{contactName(contact, contact.id)}</strong>{contact.unread > 0 && <span className="desk-badge accent">{contact.unread} new</span>}</span>
                  <span className="desk-contact-meta">@{contact.username ?? contact.id} · {contact.lastMsgAt ? timeText(contact.lastMsgAt) : "No messages yet"}</span>
                  {isAdmin && <span className="desk-contact-meta">{contact.role}{contact.lastActivityAt ? ` · active ${timeText(contact.lastActivityAt)}` : " · no activity"}</span>}
                </button>
                {isAdmin && <button type="button" className="desk-icon-button" aria-label={`Inspect ${contactName(contact, contact.id)}`} onClick={() => setInfoFor(infoFor === contact.id ? null : contact.id)}><Info size={15} /></button>}
              </div>
            ))}
          </div>
        </Card>
        <div className="desk-thread-panel">
          {open ? <Thread key={open.id} contact={open} visible={visible} onBack={() => setSelected(null)} /> : <Card className="desk-thread"><div className="desk-empty">Select a conversation.</div></Card>}
        </div>
        {isAdmin && infoFor !== null && <UserIntel userId={infoFor} onClose={() => setInfoFor(null)} />}
      </div>
      <DevNotes page="messages" />
    </div>
  );
}
