/**
 * /login — local username/password sign-in (4d, D33). Replaces the Kimi
 * OAuth button as the production path (the owner: "Kimi auth won't be needed
 * after release"). The captcha block appears only when the server asks for
 * it (≥3 failed attempts for this address+username — anti-bruteforce
 * escalation, api/services/login-guard.ts).
 */
import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { jobToast } from "@/lib/job-toast";

export default function Login() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  // the server escalates to captcha after repeated failures
  const [captchaNeeded, setCaptchaNeeded] = useState(false);

  const captcha = trpc.auth.captcha.useQuery(undefined, {
    enabled: captchaNeeded,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      navigate("/");
    },
    onError: (e) => {
      if (/captcha/i.test(e.message)) setCaptchaNeeded(true);
      if (captchaNeeded) captcha.refetch();
      setCaptchaAnswer("");
      jobToast("error", "Sign-in failed", e.message);
    },
  });

  const submit = () => {
    if (!username.trim() || !password || login.isPending) return;
    login.mutate({
      username: username.trim(),
      password,
      captchaId: captchaNeeded ? captcha.data?.id : undefined,
      captchaAnswer: captchaNeeded ? captchaAnswer : undefined,
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="t-panel px-8 py-10 w-full max-w-sm">
        <div className="flex justify-center mb-5">
          <div className="radar" />
        </div>
        <div className="t-mono text-[15px] font-semibold tracking-[0.2em] text-center">ALPHA ENGINE</div>
        <div className="t-label mt-1.5 mb-8 text-center">MISSION CONTROL ACCESS</div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="USERNAME"
            autoComplete="username"
            className="h-9 t-mono text-[12px] bg-[hsl(var(--secondary)/0.5)]"
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="PASSWORD"
            autoComplete="current-password"
            className="h-9 t-mono text-[12px] bg-[hsl(var(--secondary)/0.5)]"
          />
          {captchaNeeded && captcha.data && (
            <div className="flex items-center gap-2">
              <span
                className="rounded-md overflow-hidden border border-border shrink-0"
                dangerouslySetInnerHTML={{ __html: captcha.data.svg }}
              />
              <Input
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value)}
                placeholder="= ?"
                className="h-9 w-24 t-mono text-[12px] bg-[hsl(var(--secondary)/0.5)]"
              />
            </div>
          )}
          <Button
            type="submit"
            className="w-full t-mono text-[11px] uppercase tracking-[0.14em] bg-[hsl(var(--live))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--live)/0.85)]"
            size="lg"
            disabled={login.isPending || !username.trim() || !password}
          >
            {login.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <div className="mt-5 text-center">
          <Link to="/signup" className="t-mono text-[10px] text-muted-foreground hover:text-[hsl(var(--live))] uppercase tracking-[0.12em]">
            Create an account →
          </Link>
        </div>
      </div>
    </div>
  );
}
