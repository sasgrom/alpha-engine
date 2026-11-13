import { useState } from "react";
import { KeyRound, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Card } from "../components";

export default function Reviewers() {
  const utils = trpc.useUtils();
  const list = trpc.admin.reviewerList.useQuery(undefined, { retry: false });
  const [form, setForm] = useState({ username: "", password: "", name: "" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const options = (message: string) => ({
    onSuccess: () => {
      setNotice(message);
      setError("");
      void utils.admin.reviewerList.invalidate();
      void utils.admin.usersList.invalidate();
    },
    onError: (reason: { message: string }) => setError(reason.message),
  });
  const create = trpc.admin.createReviewer.useMutation({
    ...options("Reviewer created"),
    onSuccess: () => {
      setForm({ username: "", password: "", name: "" });
      options("Reviewer created").onSuccess();
    },
  });
  const resetIp = trpc.admin.resetReviewerFirstIp.useMutation(options("IP binding and NDA reset"));
  const resetNda = trpc.admin.resetReviewerNda.useMutation(options("NDA reset"));
  const resetTour = trpc.admin.resetReviewerTour.useMutation(options("Tours reset"));
  const remove = trpc.admin.deleteUser.useMutation(options("Reviewer deleted"));

  return (
    <>
      <Card title="Create reviewer" subtitle="Read-only access with an NDA, first-IP binding, two guided tours and a 50-company presentation universe.">
        <form className="desk-form-grid" onSubmit={(event) => {
          event.preventDefault();
          create.mutate({ username: form.username.trim(), password: form.password, name: form.name.trim() || undefined });
        }}>
          <label>Username<input className="desk-input" aria-label="Reviewer username" required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
          <label>Password<input className="desk-input" aria-label="Reviewer password" required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          <label>Display name<input className="desk-input" aria-label="Reviewer display name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <button type="submit" className="desk-button primary" disabled={create.isPending}><UserPlus size={14} /> Create reviewer</button>
        </form>
      </Card>
      {notice && <p className="desk-form-success" role="status">{notice}</p>}
      {error && <p className="desk-form-error" role="alert">{error}</p>}
      <Card flush title="Reviewer profiles" subtitle="The acceptance date and IP-binding state are shown; raw IP addresses and IP hashes are not exposed.">
        <div className="desk-table-wrap">
          <table className="desk-table">
            <thead><tr><th>Reviewer</th><th>NDA accepted</th><th>IP binding</th><th className="num">Universe</th><th>Tours</th><th className="num">Actions</th></tr></thead>
            <tbody>
              {(list.data ?? []).map((profile) => (
                <tr key={profile.userId}>
                  <td><strong>{profile.name ?? profile.username}</strong><span className="desk-muted desk-block">@{profile.username ?? profile.userId}</span></td>
                  <td>{profile.ndaAccepted && profile.acceptedAt ? String(profile.acceptedAt).slice(0, 19).replace("T", " ") : "Pending"}</td>
                  <td><span className="desk-badge">{profile.firstIpBound ? "Bound" : "Not bound"}</span></td>
                  <td className="num">{profile.universeSize}</td>
                  <td>{profile.tours.map((tour) => `${tour.track} ${tour.currentStep}/${tour.status}`).join(" · ") || "Not started"}</td>
                  <td className="num"><div className="desk-row-actions">
                    <button type="button" className="desk-button" onClick={() => resetIp.mutate({ userId: profile.userId })}><RotateCcw size={13} /> Reset IP+NDA</button>
                    <button type="button" className="desk-button" onClick={() => resetNda.mutate({ userId: profile.userId })}><KeyRound size={13} /> Reset NDA</button>
                    <button type="button" className="desk-button" onClick={() => resetTour.mutate({ userId: profile.userId })}><RotateCcw size={13} /> Reset tour</button>
                    <button type="button" className="desk-button danger" onClick={() => {
                      if (window.confirm(`Delete reviewer ${profile.username ?? profile.userId}? The account, tours and presentation universe are removed too.`)) remove.mutate({ userId: profile.userId });
                    }}><Trash2 size={13} /> Delete</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data?.length === 0 && <div className="desk-empty">No reviewer profiles yet.</div>}
        </div>
      </Card>
    </>
  );
}
