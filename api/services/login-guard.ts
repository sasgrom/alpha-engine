/**
 * Login guard (4d, D33) — brute-force protection for password auth.
 * In-process by design (single-instance deployment, D25): a restart resets
 * counters, which is acceptable — the DB-free guard can never lock out
 * permanently and never becomes a stale-state liability.
 *
 * Rules:
 *  - login:    ≥3 failures (per ip+username) → captcha required;
 *              ≥5 failures in a 10 min window → 10 min lockout;
 *  - signup:   ≤5 signups per IP per hour (account-farming throttle).
 * Error texts stay generic — no user-existence oracle.
 */
type Rec = { fails: number; firstAt: number; lockedUntil: number };
type Sig = { count: number; firstAt: number };

const attempts = new Map<string, Rec>();
const signups = new Map<string, Sig>();

const FAIL_WINDOW_MS = 10 * 60_000;
const LOCK_MS = 10 * 60_000;
const MAX_FAILS = 5;
const CAPTCHA_AFTER = 3;
const SIGNUP_WINDOW_MS = 3600_000;
const SIGNUP_MAX = 5;

const key = (ip: string, username: string) => `${ip}|${username.toLowerCase()}`;

/** Pre-flight check for a login attempt. */
export function loginGate(ip: string, username: string): { locked: boolean; captchaRequired: boolean; retryAfterSec: number } {
  const r = attempts.get(key(ip, username));
  if (!r) return { locked: false, captchaRequired: false, retryAfterSec: 0 };
  const now = Date.now();
  if (r.lockedUntil > now) {
    return { locked: true, captchaRequired: true, retryAfterSec: Math.ceil((r.lockedUntil - now) / 1000) };
  }
  if (now - r.firstAt > FAIL_WINDOW_MS) {
    attempts.delete(key(ip, username));
    return { locked: false, captchaRequired: false, retryAfterSec: 0 };
  }
  return { locked: false, captchaRequired: r.fails >= CAPTCHA_AFTER, retryAfterSec: 0 };
}

export function loginFailed(ip: string, username: string): void {
  const k = key(ip, username);
  const now = Date.now();
  const r = attempts.get(k);
  if (!r || now - r.firstAt > FAIL_WINDOW_MS) {
    attempts.set(k, { fails: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  r.fails += 1;
  if (r.fails >= MAX_FAILS) r.lockedUntil = now + LOCK_MS;
}

export function loginSucceeded(ip: string, username: string): void {
  attempts.delete(key(ip, username));
}

/** true = allowed; false = throttled. */
export function signupAllowed(ip: string): boolean {
  const now = Date.now();
  const s = signups.get(ip);
  if (!s || now - s.firstAt > SIGNUP_WINDOW_MS) {
    signups.set(ip, { count: 1, firstAt: now });
    return true;
  }
  if (s.count >= SIGNUP_MAX) return false;
  s.count += 1;
  return true;
}
