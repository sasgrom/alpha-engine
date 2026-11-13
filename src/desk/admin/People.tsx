import { useState } from "react";
import { useNavigate } from "react-router";
import { Eye, KeyRound, Trash2, UserPlus } from "lucide-react";
import { trpc, VIEW_AS_KEY } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "../components";
import { DeskDialog } from "../DeskDialog";

function generatedPassword(): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure password generation is unavailable in this browser");
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `A9${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export default function People() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const list = trpc.admin.usersList.useQuery(undefined, { retry: false });
  const [form, setForm] = useState({ username: "", password: "", name: "", role: "user" as "user" | "admin" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [reset, setReset] = useState<{ userId: number; username: string; password: string; done: boolean } | null>(null);
  const [deleting, setDeleting] = useState<{ userId: number; username: string } | null>(null);
  const options = (message: string) => ({
    onSuccess: () => {
      setError("");
      setNotice(message);
      void utils.admin.usersList.invalidate();
    },
    onError: (reason: { message: string }) => setError(reason.message),
  });
  const create = trpc.admin.createUser.useMutation({
    ...options("Account created"),
    onSuccess: () => {
      setForm({ username: "", password: "", name: "", role: "user" });
      options("Account created").onSuccess();
    },
  });
  const remove = trpc.admin.deleteUser.useMutation({
    ...options("Account deleted"),
    onSuccess: () => {
      setDeleting(null);
      options("Account deleted").onSuccess();
    },
  });
  const changeRole = trpc.admin.setUserRole.useMutation(options("Role updated"));
  const resetPassword = trpc.admin.resetPassword.useMutation({
    onSuccess: () => {
      setReset((current) => current ? { ...current, done: true } : current);
      setNotice("Password reset");
      setError("");
      void utils.admin.usersList.invalidate();
    },
    onError: (reason) => setError(reason.message),
  });

  return (
    <>
      <Card title="Create account" subtitle="New accounts start with an empty universe. Owner-chosen passwords skip the public signup policy.">
        <form className="desk-form-grid" onSubmit={(event) => {
          event.preventDefault();
          create.mutate({ username: form.username.trim(), password: form.password, name: form.name.trim() || undefined, role: form.role });
        }}>
          <label>Username<input className="desk-input" required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
          <label>Password<input className="desk-input" required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          <label>Display name<input className="desk-input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Role<select className="desk-select" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as "user" | "admin" })}><option value="user">user</option><option value="admin">admin</option></select></label>
          <button type="submit" className="desk-button primary" disabled={create.isPending}><UserPlus size={14} /> Create account</button>
        </form>
      </Card>
      {notice && <p className="desk-form-success" role="status">{notice}</p>}
      {error && <p className="desk-form-error" role="alert">{error}</p>}
      <Card flush title="Accounts" subtitle="Your own account is protected from deletion and role changes.">
        <div className="desk-table-wrap">
          <table className="desk-table">
            <thead><tr><th>Account</th><th>Role</th><th className="num">Universe</th><th>Last sign-in</th><th>Created</th><th className="num">Actions</th></tr></thead>
            <tbody>
              {(list.data ?? []).map((account) => (
                <tr key={account.id}>
                  <td><strong>{account.name ?? account.username}</strong><span className="desk-muted desk-block">@{account.username ?? account.id} · ID {account.id}</span></td>
                  <td><span className="desk-badge">{account.role}</span></td>
                  <td className="num">{account.universeSize}</td>
                  <td>{account.lastSignInAt ? String(account.lastSignInAt).slice(0, 16).replace("T", " ") : "—"}</td>
                  <td>{String(account.createdAt).slice(0, 10)}</td>
                  <td className="num">
                    {account.id === user?.id ? <span className="desk-muted">This account</span> : (
                      <div className="desk-row-actions">
                        <button type="button" className="desk-button" onClick={() => {
                          localStorage.setItem(VIEW_AS_KEY, String(account.id));
                          window.dispatchEvent(new Event("alpha-viewas-changed"));
                          void utils.invalidate();
                          navigate("/desk");
                        }}><Eye size={13} /> View as</button>
                        <button type="button" className="desk-button" onClick={() => {
                          try {
                            setReset({ userId: account.id, username: account.username ?? String(account.id), password: generatedPassword(), done: false });
                            setError("");
                          } catch (reason) {
                            setError((reason as Error).message);
                          }
                        }}><KeyRound size={13} /> Reset password</button>
                        <button type="button" className="desk-button" onClick={() => changeRole.mutate({ userId: account.id, role: account.role === "admin" ? "user" : "admin" })}>{account.role === "admin" ? "Demote" : "Promote"}</button>
                        <button type="button" className="desk-button danger" onClick={() => setDeleting({ userId: account.id, username: account.username ?? String(account.id) })}><Trash2 size={13} /> Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data?.length === 0 && <div className="desk-empty">No other accounts yet.</div>}
        </div>
      </Card>
      {reset && (
        <DeskDialog title={`Reset password for ${reset.username}`} onClose={() => setReset(null)}>
          <p>{reset.done ? "The password was reset. Copy this generated password now; it will be hidden when the dialog closes." : "A new password has been generated for this account. Confirm the reset to make it active."}</p>
          <input className="desk-input desk-generated-password" aria-label="Generated password" readOnly autoFocus onFocus={(event) => event.target.select()} value={reset.password} />
          <div className="desk-modal-actions">
            <button type="button" className="desk-button" onClick={() => void navigator.clipboard?.writeText(reset.password)}>Copy password</button>
            {!reset.done && <button type="button" className="desk-button primary" disabled={resetPassword.isPending} onClick={() => resetPassword.mutate({ userId: reset.userId, password: reset.password })}>Confirm reset</button>}
            <button type="button" className="desk-button" onClick={() => setReset(null)}>Close</button>
          </div>
        </DeskDialog>
      )}
      {deleting && (
        <DeskDialog title={`Delete ${deleting.username}?`} onClose={() => setDeleting(null)}>
          <p>This removes the account, its universe and its messages. Shared company data is not changed.</p>
          <div className="desk-modal-actions">
            <button type="button" className="desk-button" onClick={() => setDeleting(null)}>Cancel</button>
            <button type="button" className="desk-button danger" disabled={remove.isPending} onClick={() => remove.mutate({ userId: deleting.userId })}>Confirm delete</button>
          </div>
        </DeskDialog>
      )}
    </>
  );
}
