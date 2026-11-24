/**
 * The viewer's own account security: the second factor (an authenticator app) and the open sessions.
 * Set-up asks for the password again, shows the secret as a QR code and as text, and turns the second factor on
 * only when a code from the app proves the app has it. The recovery codes are shown once.
 */
import { useMemo, useState, type FormEvent } from "react";
import qrcode from "qrcode-generator";
import { trpc } from "@/providers/trpc";
import { Card, Shimmer, StatusLabel } from "../components";
import { useDocumentTitle } from "../context";
import { fmtDateTime } from "../format";

/** A browser and system in a few words, from the User-Agent header. */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const system = /iPhone|iPad/.test(userAgent) ? "iPhone or iPad" : /Android/.test(userAgent) ? "Android" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X|Macintosh/.test(userAgent) ? "Mac" : /Linux/.test(userAgent) ? "Linux" : "Unknown system";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "a program";
  return `${browser} on ${system}`;
}

function QrCode({ text }: { text: string }) {
  const svg = useMemo(() => { const code = qrcode(0, "M"); code.addData(text); code.make(); return code.createSvgTag({ cellSize: 4, margin: 3, scalable: true }); }, [text]);
  // the markup is made here from the secret, not received from anywhere
  return <div aria-label="QR code for the authenticator app" role="img" style={{ width: 196, height: 196, background: "#fff", borderRadius: 8, padding: 4 }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function Security() {
  useDocumentTitle("Security");
  const utils = trpc.useUtils();
  const state = trpc.auth.security.useQuery(undefined, { staleTime: 15_000 });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => utils.auth.security.invalidate();
  const failed = (failure: { message: string }) => setError(failure.message);
  const begin = trpc.auth.secondFactorBegin.useMutation({ onSuccess: (result) => { setSetup(result); setPassword(""); setError(null); }, onError: failed });
  const enable = trpc.auth.secondFactorEnable.useMutation({ onSuccess: (result) => { setRecovery(result.recoveryCodes); setSetup(null); setCode(""); setError(null); void refresh(); }, onError: failed });
  const disable = trpc.auth.secondFactorDisable.useMutation({ onSuccess: () => { setTurningOff(false); setPassword(""); setCode(""); setError(null); void refresh(); }, onError: failed });
  const end = trpc.auth.revokeSession.useMutation({ onSuccess: refresh, onError: failed });
  const endOthers = trpc.auth.revokeOtherSessions.useMutation({ onSuccess: refresh, onError: failed });
  const submit = (action: () => void) => (event: FormEvent) => { event.preventDefault(); setError(null); action(); };

  if (state.isLoading) return <Shimmer height={420} />;
  const factor = state.data?.secondFactor, sessions = state.data?.sessions ?? [];
  const others = sessions.filter((session) => !session.current).length;

  return (
    <div>
      <div className="desk-page-head">
        <div>
          <span className="desk-eyebrow">Your account</span>
          <h1>Security</h1>
          <p className="desk-lede">A second step at sign-in, and the places where you are signed in.</p>
        </div>
      </div>

      <div className="desk-grid">
        <Card className="desk-span-6" title="Second factor" subtitle="A 6-digit code from an authenticator app, asked for after the password." action={<StatusLabel status={factor?.enabled ? "ok" : "warning"} label={factor?.enabled ? "On" : "Off"} />}>
          {recovery ? (
            <div data-recovery-codes>
              <p style={{ margin: "0 0 8px", fontWeight: 560 }}>The second factor is on. Save these recovery codes now.</p>
              <p className="desk-ink-2" style={{ margin: "0 0 10px", fontSize: 13 }}>Each works once in place of the app's code, for when the phone is lost. They are not shown again.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: "4px 28px", fontFamily: "ui-monospace, \"SF Mono\", \"Cascadia Mono\", Menlo, monospace", fontSize: 14 }}>
                {recovery.map((item) => <span key={item}>{item}</span>)}
              </div>
              <button type="button" className="desk-button" style={{ marginTop: 14 }} onClick={() => setRecovery(null)}>I have saved them</button>
            </div>
          ) : factor?.enabled ? (
            turningOff ? (
              <form onSubmit={submit(() => disable.mutate({ password, code: code.trim() }))} style={{ display: "grid", gap: 8, maxWidth: 320 }}>
                <label htmlFor="security-off-password">Password</label>
                <input id="security-off-password" className="desk-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                <label htmlFor="security-off-code">Current code, or a recovery code</label>
                <input id="security-off-code" className="desk-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button type="submit" className="desk-button" disabled={!password || code.trim().length < 6 || disable.isPending}>Turn it off</button>
                  <button type="button" className="desk-button" onClick={() => { setTurningOff(false); setError(null); }}>Keep it on</button>
                </div>
              </form>
            ) : (
              <div>
                <p className="desk-ink-2" style={{ margin: "0 0 10px", fontSize: 13.5 }}>On since {fmtDateTime(String(factor.enabledAt))}. {factor.recoveryCodesLeft} of 10 recovery codes are unused.</p>
                <button type="button" className="desk-button" onClick={() => { setTurningOff(true); setError(null); }}>Turn it off</button>
              </div>
            )
          ) : setup ? (
            <form onSubmit={submit(() => enable.mutate({ code: code.trim() }))} style={{ display: "grid", gap: 10 }}>
              <p style={{ margin: 0, fontSize: 13.5 }}>1. Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy).</p>
              <QrCode text={setup.uri} />
              <p className="desk-ink-2" style={{ margin: 0, fontSize: 13 }}>Or type this key into the app: <code data-secret style={{ userSelect: "all", wordBreak: "break-all" }}>{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code></p>
              <label htmlFor="security-code" style={{ fontSize: 13.5 }}>2. Enter the 6-digit code the app now shows.</label>
              <input id="security-code" className="desk-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} style={{ maxWidth: 160 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" className="desk-button primary" disabled={code.trim().length < 6 || enable.isPending}>Turn it on</button>
                <button type="button" className="desk-button" onClick={() => { setSetup(null); setCode(""); setError(null); }}>Cancel</button>
              </div>
            </form>
          ) : (
            <form onSubmit={submit(() => begin.mutate({ password }))} style={{ display: "grid", gap: 8, maxWidth: 320 }}>
              <p className="desk-ink-2" style={{ margin: 0, fontSize: 13.5 }}>With it on, a stolen password alone does not open your account. Enter your password to begin.</p>
              <label htmlFor="security-password">Password</label>
              <input id="security-password" className="desk-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <button type="submit" className="desk-button primary" disabled={!password || begin.isPending} style={{ justifySelf: "start", marginTop: 4 }}>Set it up</button>
            </form>
          )}
          {error && <p className="desk-signin-error" role="alert" style={{ marginTop: 10 }}>{error}</p>}
        </Card>

        <Card className="desk-span-6" title="Where you are signed in" subtitle="Each sign-in lasts 30 days unless ended. Ending one signs that browser out at once."
          action={others > 0 ? <button type="button" className="desk-button" disabled={endOthers.isPending} onClick={() => endOthers.mutate()}>Sign out everywhere else</button> : undefined}>
          {sessions.length ? (
            <div data-sessions>
              {sessions.map((session) => (
                <div key={session.id} className="desk-list-row" style={{ alignItems: "flex-start" }}>
                  <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 560 }}>{deviceLabel(session.userAgent)}{session.current ? <span className="desk-badge accent" style={{ marginLeft: 8 }}>this browser</span> : null}</span>
                    <span className="desk-ink-2" style={{ fontSize: 12.5, whiteSpace: "normal" }}>Signed in {fmtDateTime(String(session.createdAt))} · last active {fmtDateTime(String(session.lastSeenAt))} · from {session.ip === "local" ? "this machine" : session.ip ?? "an unknown address"}</span>
                  </span>
                  {!session.current && <button type="button" className="desk-button" disabled={end.isPending} onClick={() => end.mutate({ id: session.id })}>End</button>}
                </div>
              ))}
            </div>
          ) : (
            <div className="desk-empty">No open sessions are recorded.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
