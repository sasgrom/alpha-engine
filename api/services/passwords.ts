/**
 * Password hashing (4c→4d, D33) — scrypt via node:crypto (zero new deps,
 * memory-hard, per-user salt), PHC-style storage string:
 *   scrypt$N$r$p$<salt hex>$<key hex>
 * Verification uses a timing-safe comparison. Never log passwords or hashes.
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// promisify loses the `options` parameter in its typings — restate explicitly
const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N?: number; r?: number; p?: number }
) => Promise<Buffer>;
const N = 16384,
  r = 8,
  p = 1,
  KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Constant-time verify; malformed stored strings simply fail closed. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nS, rS, pS, saltHex, keyHex] = parts;
  try {
    const key = await scrypt(password, Buffer.from(saltHex, "hex"), KEYLEN, {
      N: Number(nS),
      r: Number(rS),
      p: Number(pS),
    });
    const expect = Buffer.from(keyHex, "hex");
    return key.length === expect.length && timingSafeEqual(key, expect);
  } catch {
    return false;
  }
}

/** Public-signup policy (D33): min 8 chars, at least one letter and one digit. */
export function passwordPolicyError(pw: string): string | null {
  if (pw.length < 8) return "password must be at least 8 characters";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "password needs at least one letter and one digit";
  return null;
}

/** Username policy: 3–32 chars, letters/digits/underscore (URL- and log-safe). */
export function usernamePolicyError(name: string): string | null {
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(name)) return "username: 3–32 chars, letters/digits/underscore only";
  return null;
}
