/**
 * Login guard: brute-force protection for password sign-in. In-process by design (one server; a restart resets the
 * counters, so the guard can never lock anyone out for good).
 *
 * Three counters, because an attacker chooses what to vary:
 *   address + username   3 failures -> captcha; 5 in 10 minutes -> that pair is locked for 10 minutes
 *   username             failures from ANY address: 3 in 15 minutes -> captcha for that name from everywhere;
 *                        10 -> the name is locked for 15 minutes for remote addresses (changing address does not help).
 *                        A sign-in at the home machine itself ("local") is never locked by this counter, so the owner
 *                        cannot be shut out from outside
 *   address              20 failures in 10 minutes over any names (password spraying) -> locked for 30 minutes
 * Sign-up: at most 5 per address per hour, and only when sign-up is open at all (see signupOpen).
 * The address must be the one the trusted proxy wrote (perimeter.trustedClientIp), never a header the visitor sets.
 * Error texts stay generic: no hint whether a username exists.
 */
type Rec = { fails: number; firstAt: number; lockedUntil: number };
type Sig = { count: number; firstAt: number };

const pairs = new Map<string, Rec>();
const names = new Map<string, Rec>();
const addresses = new Map<string, Rec>();
const signups = new Map<string, Sig>();

const PAIR = { window: 10 * 60_000, lock: 10 * 60_000, max: 5, captcha: 3 };
const NAME = { window: 15 * 60_000, lock: 15 * 60_000, max: 10, captcha: 3 };
const ADDRESS = { window: 10 * 60_000, lock: 30 * 60_000, max: 20 };
const SIGNUP_WINDOW_MS = 3600_000;
const SIGNUP_MAX = 5;
/** The address of a sign-in made on the home machine itself, not through the proxy. */
export const LOCAL_ADDRESS = "local";

const pairKey = (ip: string, username: string) => `${ip}|${username.toLowerCase()}`;
const nameKey = (username: string) => username.toLowerCase();

function live(map: Map<string, Rec>, key: string, window: number, now: number): Rec | null {
  const record = map.get(key);
  if (!record) return null;
  if (record.lockedUntil <= now && now - record.firstAt > window) { map.delete(key); return null; }
  return record;
}

function fail(map: Map<string, Rec>, key: string, rule: { window: number; lock: number; max: number }, now: number): void {
  const record = live(map, key, rule.window, now);
  if (!record || now - record.firstAt > rule.window) { map.set(key, { fails: 1, firstAt: now, lockedUntil: 0 }); return; }
  record.fails += 1;
  if (record.fails >= rule.max) record.lockedUntil = now + rule.lock;
}

/** Pre-flight check for a login attempt. */
export function loginGate(ip: string, username: string, now: number = Date.now()): { locked: boolean; captchaRequired: boolean; retryAfterSec: number } {
  const pair = live(pairs, pairKey(ip, username), PAIR.window, now), name = live(names, nameKey(username), NAME.window, now), address = live(addresses, ip, ADDRESS.window, now);
  const locks = [pair?.lockedUntil ?? 0, address && ip !== LOCAL_ADDRESS ? address.lockedUntil : 0, name && ip !== LOCAL_ADDRESS ? name.lockedUntil : 0];
  const until = Math.max(...locks);
  if (until > now) return { locked: true, captchaRequired: true, retryAfterSec: Math.ceil((until - now) / 1000) };
  return { locked: false, captchaRequired: (pair?.fails ?? 0) >= PAIR.captcha || (name?.fails ?? 0) >= NAME.captcha, retryAfterSec: 0 };
}

export function loginFailed(ip: string, username: string, now: number = Date.now()): void {
  fail(pairs, pairKey(ip, username), PAIR, now);
  fail(names, nameKey(username), NAME, now);
  fail(addresses, ip, ADDRESS, now);
}

/** A correct password clears that pair and the name's counter; the address keeps its count of other names tried. */
export function loginSucceeded(ip: string, username: string): void {
  pairs.delete(pairKey(ip, username));
  names.delete(nameKey(username));
}

/**
 * Whether anyone may create an account. Closed unless the owner starts the server with SIGNUP_OPEN=1: accounts are
 * made by the owner (People page). An open sign-up would let any visitor read the desk.
 */
export function signupOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.SIGNUP_OPEN === "1";
}

/** true = allowed; false = throttled. */
export function signupAllowed(ip: string, now: number = Date.now()): boolean {
  const s = signups.get(ip);
  if (!s || now - s.firstAt > SIGNUP_WINDOW_MS) {
    signups.set(ip, { count: 1, firstAt: now });
    return true;
  }
  if (s.count >= SIGNUP_MAX) return false;
  s.count += 1;
  return true;
}

/** For tests: forget every counter. */
export function resetLoginGuard(): void {
  pairs.clear(); names.clear(); addresses.clear(); signups.clear();
}
