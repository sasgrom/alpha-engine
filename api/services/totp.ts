/**
 * Time-based one-time passwords (RFC 6238, the scheme every authenticator app speaks): a 160-bit secret shared once,
 * then a 6-digit code that changes every 30 seconds. Pure functions over node:crypto; the database side is in
 * second-factor.ts. A code is accepted for the current step and one step either side (clock drift), and a step that
 * was already used is refused (a code seen over a shoulder cannot be replayed).
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(bytes: Buffer): string {
  let bits = 0, value = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const char of text.toUpperCase().replace(/[\s=-]/g, "")) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("not a base32 secret");
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/** The code for one 30-second step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(number % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * The step a code is valid for, or null. Only steps after `lastStep` count, so a code works once. Compared in
 * constant time.
 */
export function verifyTotp(secret: string, code: string, nowMs: number, lastStep = 0): number | null {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const current = totpStep(nowMs);
  for (const step of [current, current - 1, current + 1]) {
    if (step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(given))) return step;
  }
  return null;
}

/** What an authenticator app reads from the QR code. */
export function otpauthUri(secret: string, account: string, issuer = "Alpha Engine"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** Ten single-use recovery codes ("xxxxx-xxxxx", 50 bits each) for a lost phone. */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => { const text = base32Encode(randomBytes(7)).toLowerCase().slice(0, 10); return `${text.slice(0, 5)}-${text.slice(5)}`; });
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z2-7]/g, "");
export const hashRecoveryCode = (code: string) => createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");

/** The secret at rest: AES-256-GCM under a key derived from the server's own secret. "v1.<iv>.<tag>.<data>", base64url. */
export function encryptSecret(secret: string, appSecret: string): string {
  if (!appSecret) throw new Error("the server secret is not set");
  const key = createHash("sha256").update(`second-factor|${appSecret}`).digest(), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(stored: string, appSecret: string): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("unreadable second-factor secret");
  const key = createHash("sha256").update(`second-factor|${appSecret}`).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
