/**
 * /signup — public account creation (4d, D33), hardened by design:
 *  - SVG math captcha is ALWAYS required (one-shot, 5-minute TTL);
 *  - per-IP throttle (5 signups/hour) server-side;
 *  - username policy 3–32 [a-z0-9_], password min 8 + letter + digit;
 *  - the created role is always "user" — there is no privilege-escalation
 *    path in the payload (the server ignores any role field).
 * New accounts start with an EMPTY personal universe (D30).
 */
import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { jobToast } from "@/lib/job-toast";

export default function Signup() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");

  const captcha = trpc.auth.captcha.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });

  const signup = trpc.auth.signup.useMutation({
    onSuccess: async () => {
      jobToast("success", "Account created", `welcome, ${username.trim()}`);
      await utils.invalidate();
      navigate("/");
    },
    onError: (e) => {
      captcha.refetch();
      setCaptchaAnswer("");
      jobToast("error", "Signup failed", e.message);
    },
  });

  const mismatch = confirm.length > 0 && confirm !== password;
  const ready =
    /^[a-zA-Z0-9_]{3,32}$/.test(username) &&
    password.length >= 8 &&
    /[a-zA-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    password === confirm &&
    captchaAnswer.trim().length > 0;

  const submit = () => {
    if (!ready || !captcha.data || signup.isPending) return;
    signup.mutate({
      username: username.trim(),
      password,
      captchaId: captcha.data.id,
      captchaAnswer: captchaAnswer.trim(),
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="t-panel px-8 py-10 w-full max-w-sm">
        <div className="flex justify-center mb-5">
          <div className="radar" />
        </div>
        <div className="t-mono text-[15px] font-semibold tracking-[0.2em] text-center">CREATE ACCOUNT</div>
        <div className="t-label mt-1.5 mb-6 text-center">ALPHA ENGINE — USER ACCESS</div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="USERNAME (a–z 0–9 _)"
              autoComplete="username"
              className="h-9 t-mono text-[12px] bg-[hsl(var(--secondary)/0.5)]"
            />
            <div className="t-mono text-[9px] text-muted-foreground mt-1">3–32 chars · letters, digits, underscore</div>
          </div>
          <div>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="PASSWORD"
              autoComplete="new-password"
              className="h-9 t-mono text-[12px] bg-[hsl(var(--secondary)/0.5)]"
            />
            <div className="t-mono text-[9px] text-muted-foreground mt-1">min 8 chars · at least one letter and one digit</div>
          </div>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="CONFIRM PASSWORD"
            autoComplete="new-password"
            className={`h-9 t-mono text-[12px] bg-[hsl(var(--secondary)/0.5)] ${mismatch ? "border-[hsl(var(--crit))]" : ""}`}
          />
          {mismatch && <div className="t-mono text-[9px] text-[hsl(var(--crit))]">passwords do not match</div>}
          <div className="flex items-center gap-2">
            {captcha.data ? (
              <span
                className="rounded-md overflow-hidden border border-border shrink-0"
                dangerouslySetInnerHTML={{ __html: captcha.data.svg }}
              />
            ) : (
              <span className="t-mono text-[10px] text-muted-foreground">loading captcha…</span>
            )}
            <Input
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
              placeholder="= ?"
              className="h-9 w-24 t-mono text-[12px] bg-[hsl(var(--secondary)/0.5)]"
            />
          </div>
          <Button
            type="submit"
            className="w-full t-mono text-[11px] uppercase tracking-[0.14em] bg-[hsl(var(--live))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--live)/0.85)]"
            size="lg"
            disabled={!ready || signup.isPending}
          >
            {signup.isPending ? "Creating…" : "Create account"}
          </Button>
        </form>
        <div className="mt-5 text-center">
          <Link to="/login" className="t-mono text-[10px] text-muted-foreground hover:text-[hsl(var(--live))] uppercase tracking-[0.12em]">
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
