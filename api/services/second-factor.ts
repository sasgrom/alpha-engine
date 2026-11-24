/**
 * The second factor of an account (DDL 034): set-up, the check at sign-in, recovery codes and turning it off. The
 * codes themselves are in totp.ts. The secret is stored encrypted; recovery codes as hashes, each usable once.
 * An account without a row, or with a row that was never confirmed, signs in with its password alone.
 */
import { eq } from "drizzle-orm";
import { userSecondFactor } from "@db/schema";
import { env } from "../lib/env";
import { getDb } from "../queries/connection";
import { decryptSecret, encryptSecret, hashRecoveryCode, newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUri, verifyTotp } from "./totp";

async function row(userId: number) {
  const [found] = await getDb().select().from(userSecondFactor).where(eq(userSecondFactor.userId, userId)).limit(1);
  return found ?? null;
}

export async function secondFactorEnabled(userId: number): Promise<boolean> {
  return Boolean((await row(userId))?.enabledAt);
}

export async function secondFactorStatus(userId: number): Promise<{ enabled: boolean; enabledAt: Date | null; recoveryCodesLeft: number }> {
  const found = await row(userId);
  return { enabled: Boolean(found?.enabledAt), enabledAt: found?.enabledAt ?? null, recoveryCodesLeft: found?.enabledAt ? (JSON.parse(found.recoveryHashes) as string[]).length : 0 };
}

/** Starts set-up: a new secret, not yet in force. Refused while a second factor is on (turn it off first). */
export async function beginSecondFactor(userId: number, account: string): Promise<{ secret: string; uri: string }> {
  const found = await row(userId);
  if (found?.enabledAt) throw new Error("A second factor is already on for this account");
  const secret = newTotpSecret(), secretEnc = encryptSecret(secret, env.appSecret);
  if (found) await getDb().update(userSecondFactor).set({ secretEnc, lastStep: 0, recoveryHashes: "[]" }).where(eq(userSecondFactor.userId, userId));
  else await getDb().insert(userSecondFactor).values({ userId, secretEnc, recoveryHashes: "[]" });
  return { secret, uri: otpauthUri(secret, account) };
}

/** Confirms set-up with a code from the app; returns the recovery codes, shown once. Null when the code is wrong. */
export async function enableSecondFactor(userId: number, code: string, now: number = Date.now()): Promise<string[] | null> {
  const found = await row(userId);
  if (!found || found.enabledAt) return null;
  const step = verifyTotp(decryptSecret(found.secretEnc, env.appSecret), code, now, 0);
  if (step === null) return null;
  const codes = newRecoveryCodes();
  await getDb().update(userSecondFactor).set({ enabledAt: new Date(now), lastStep: step, recoveryHashes: JSON.stringify(codes.map(hashRecoveryCode)) }).where(eq(userSecondFactor.userId, userId));
  return codes;
}

/**
 * The check at sign-in: a 6-digit code from the app (each 30-second step once), or one recovery code (each once).
 * Returns how it passed, or null.
 */
export async function checkSecondFactor(userId: number, code: string, now: number = Date.now()): Promise<"code" | "recovery" | null> {
  const found = await row(userId);
  if (!found?.enabledAt) return null;
  const given = code.trim();
  if (/^\d{6}$/.test(given.replace(/\s/g, ""))) {
    const step = verifyTotp(decryptSecret(found.secretEnc, env.appSecret), given, now, found.lastStep);
    if (step === null) return null;
    await getDb().update(userSecondFactor).set({ lastStep: step }).where(eq(userSecondFactor.userId, userId));
    return "code";
  }
  if (normalizeRecoveryCode(given).length !== 10) return null;
  const hashes = JSON.parse(found.recoveryHashes) as string[], hash = hashRecoveryCode(given);
  if (!hashes.includes(hash)) return null;
  await getDb().update(userSecondFactor).set({ recoveryHashes: JSON.stringify(hashes.filter((value) => value !== hash)) }).where(eq(userSecondFactor.userId, userId));
  return "recovery";
}

/** Removes the second factor of an account (after its own check, or by the owner's local reset script). */
export async function removeSecondFactor(userId: number): Promise<void> {
  await getDb().delete(userSecondFactor).where(eq(userSecondFactor.userId, userId));
}
