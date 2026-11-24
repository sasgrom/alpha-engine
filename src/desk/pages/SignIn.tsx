/**
 * Sign-in and account creation in the desk's own look (they were the classic view's last pages a visitor had to
 * pass). The server rules are unchanged: a sum to solve after three failed sign-ins and always when creating an
 * account, a lock after too many failures, the username and password policy, and a new account is always a member.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useDeskTheme } from "../preferences";
import "../desk.css";

type Mode = "signin" | "signup";

/** Where to go after signing in: the page the visitor was sent here from, when it is one of ours. */
export function returnPath(next: string | null): string {
  return next && /^\/(?!\/)[\w\-./?=&%:+,~]*$/.test(next) && !next.startsWith("/login") && !next.startsWith("/signup") ? next : "/";
}

/** The server's short messages, as sentences. */
function failureText(message: string, mode: Mode): string {
  if (/captcha/i.test(message)) return mode === "signin" ? "Solve the sum below to go on: there were several failed attempts." : "That answer was not right or the sum had expired. Here is a new one.";
  if (/username is taken/i.test(message)) return "That username is taken.";
  const text = message.replace(/\s+—\s+/g, ": ").trim();
  return /[.!?]$/.test(text) ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export default function SignIn({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = returnPath(params.get("next"));
  const theme = useDeskTheme();
  const utils = trpc.useUtils();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  // signing in asks for the sum only after the server says so; creating an account always does
  const [sumNeeded, setSumNeeded] = useState(mode === "signup");
  const captcha = trpc.auth.captcha.useQuery(undefined, { enabled: sumNeeded, retry: false, refetchOnWindowFocus: false, staleTime: Infinity });
  // accounts are created by the owner unless he opened sign-up; until the server says it is open the page does not offer it
  const signupState = trpc.auth.signupOpen.useQuery(undefined, { retry: false, refetchOnWindowFocus: false, staleTime: 5 * 60_000 });
  const signupIsOpen = signupState.data?.open === true;

  useEffect(() => {
    document.title = mode === "signin" ? "Sign in · Alpha Engine" : "Create an account · Alpha Engine";
    const body = document.body;
    const previous = { background: body.style.background, backgroundImage: body.style.backgroundImage };
    body.style.background = theme.resolved === "dark" ? "#0d0d0d" : "#f9f9f7";
    body.style.backgroundImage = "none";
    return () => {
      body.style.background = previous.background;
      body.style.backgroundImage = previous.backgroundImage;
    };
  }, [mode, theme.resolved]);

  const done = async () => {
    await utils.invalidate();
    navigate(next, { replace: true });
  };
  const failed = (message: string) => {
    if (/captcha/i.test(message)) setSumNeeded(true);
    if (sumNeeded) void captcha.refetch();
    setAnswer("");
    setError(failureText(message, mode));
  };
  const login = trpc.auth.login.useMutation({ onSuccess: done, onError: (failure) => failed(failure.message) });
  const signup = trpc.auth.signup.useMutation({ onSuccess: done, onError: (failure) => failed(failure.message) });
  const busy = login.isPending || signup.isPending;

  const name = username.trim();
  const nameOk = /^[a-zA-Z0-9_]{3,32}$/.test(name);
  const passwordOk = password.length >= 12 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = mode === "signin"
    ? name.length > 0 && password.length > 0 && (!sumNeeded || answer.trim().length > 0)
    : nameOk && passwordOk && confirm === password && answer.trim().length > 0 && !!captcha.data;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setError(null);
    // the sum's id and answer travel only when a sum was asked for
    if (mode === "signin") login.mutate({ username: name, password, ...(sumNeeded && captcha.data ? { captchaId: captcha.data.id, captchaAnswer: answer.trim() } : {}) });
    else signup.mutate({ username: name, password, captchaId: captcha.data!.id, captchaAnswer: answer.trim() });
  };
  const other = mode === "signin" ? "/signup" : "/login";
  const query = params.get("next") ? `?next=${encodeURIComponent(next)}` : "";

  if (mode === "signup" && signupState.data && !signupIsOpen) return <Navigate to={`/login${query}`} replace />;

  return (
    <div className="desk-root desk-signin" data-theme={theme.resolved}>
      <main className="desk-signin-card" aria-labelledby="desk-signin-title">
        <div className="desk-brand" style={{ marginBottom: 18 }}>
          <span className="desk-brand-mark">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 12.5 6 8.2l3 2.3 5-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          Alpha Engine
        </div>
        <h1 id="desk-signin-title">{mode === "signin" ? "Sign in" : "Create an account"}</h1>
        <p className="desk-muted" style={{ margin: "4px 0 18px", fontSize: 13.5 }}>
          {mode === "signin" ? "Research data on the S&P 500 companies." : "A member account: markets, the screener, company pages and your watchlist."}
        </p>
        <form onSubmit={submit} noValidate>
          <label htmlFor="desk-signin-name">Username</label>
          <input id="desk-signin-name" className="desk-input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus />
          {mode === "signup" && <p className="desk-signin-hint" data-bad={username.length > 0 && !nameOk ? "true" : undefined}>3 to 32 letters, digits or underscores.</p>}

          <label htmlFor="desk-signin-password">Password</label>
          <input id="desk-signin-password" className="desk-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
          {mode === "signup" && <p className="desk-signin-hint" data-bad={password.length > 0 && !passwordOk ? "true" : undefined}>At least 12 characters, with a letter and a digit.</p>}

          {mode === "signup" && (
            <>
              <label htmlFor="desk-signin-confirm">Password again</label>
              <input id="desk-signin-confirm" className="desk-input" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" aria-invalid={mismatch || undefined} />
              {mismatch && <p className="desk-signin-hint" data-bad="true">The two passwords differ.</p>}
            </>
          )}

          {sumNeeded && (
            <>
              <label htmlFor="desk-signin-sum">{mode === "signin" ? "Several attempts failed. Solve the sum to go on" : "Solve the sum (it keeps scripts out)"}</label>
              <div className="desk-signin-sum">
                {captcha.data ? <span className="desk-signin-svg" dangerouslySetInnerHTML={{ __html: captcha.data.svg }} /> : <span className="desk-muted" style={{ fontSize: 13 }}>{captcha.isError ? "The sum could not be loaded." : "Loading the sum"}</span>}
                <input id="desk-signin-sum" className="desk-input" inputMode="numeric" value={answer} onChange={(event) => setAnswer(event.target.value)} autoComplete="off" style={{ width: 96 }} />
                <button type="button" className="desk-link" style={{ border: "none", background: "transparent", padding: 0, font: "inherit", fontSize: 12.5, cursor: "pointer" }} onClick={() => { setAnswer(""); void captcha.refetch(); }}>Another sum</button>
              </div>
            </>
          )}

          {error && <p className="desk-signin-error" role="alert">{error}</p>}
          <button type="submit" className="desk-button primary" disabled={!ready || busy} style={{ width: "100%", justifyContent: "center", marginTop: 16, height: 40 }}>
            {mode === "signin" ? (login.isPending ? "Signing in" : "Sign in") : signup.isPending ? "Creating the account" : "Create the account"}
          </button>
        </form>
        {mode === "signup" || signupIsOpen ? (
          <p className="desk-muted" style={{ margin: "16px 0 0", fontSize: 13, textAlign: "center" }}>
            {mode === "signin" ? "No account yet? " : "Already have an account? "}
            <Link className="desk-link" to={`${other}${query}`}>{mode === "signin" ? "Create one" : "Sign in"}</Link>
          </p>
        ) : (
          <p className="desk-muted" style={{ margin: "16px 0 0", fontSize: 13, textAlign: "center" }}>Accounts are created by the owner.</p>
        )}
      </main>
      <p className="desk-muted desk-signin-foot">Research data, not investment advice.</p>
    </div>
  );
}
