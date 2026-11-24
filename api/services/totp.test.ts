import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, decryptSecret, encryptSecret, hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUri, totpCode, totpStep, verifyTotp } from "./totp";

// RFC 6238 appendix B: the ASCII secret "12345678901234567890" (SHA-1), 8-digit codes; ours are the last six digits
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("time-based codes", () => {
  it("matches the RFC 6238 test vectors", () => {
    expect(totpCode(RFC_SECRET, totpStep(59_000))).toBe("287082");
    expect(totpCode(RFC_SECRET, totpStep(1111111109_000))).toBe("081804");
    expect(totpCode(RFC_SECRET, totpStep(1234567890_000))).toBe("005924");
    expect(totpCode(RFC_SECRET, totpStep(2000000000_000))).toBe("279037");
  });

  it("round-trips base32 and makes 160-bit secrets", () => {
    expect(base32Decode(RFC_SECRET).toString()).toBe("12345678901234567890");
    expect(base32Decode("gezd gnbv-gy3t qojq").toString()).toBe("1234567890");
    expect(base32Decode(newTotpSecret())).toHaveLength(20);
    expect(() => base32Decode("not!base32")).toThrow();
  });

  it("accepts the current code and its neighbours, once", () => {
    const now = 1_800_000_000_000, step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, ` ${totpCode(RFC_SECRET, step + 1)} `, now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now)).toBeNull();
    // a step already used is refused: the same code does not work twice
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now, step)).toBe(step + 1);
  });

  it("refuses anything that is not six digits", () => {
    expect(verifyTotp(RFC_SECRET, "12345", 1_800_000_000_000)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", 1_800_000_000_000)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "", 1_800_000_000_000)).toBeNull();
  });

  it("writes the address an authenticator app reads", () => {
    expect(otpauthUri("ABC", "owner")).toBe("otpauth://totp/Alpha%20Engine:owner?secret=ABC&issuer=Alpha%20Engine&algorithm=SHA1&digits=6&period=30");
  });
});

describe("recovery codes and the stored secret", () => {
  it("makes ten different codes and hashes them however they are typed", () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(hashRecoveryCode(codes[0].toUpperCase().replace("-", " "))).toBe(hashRecoveryCode(codes[0]));
    expect(hashRecoveryCode(codes[0])).not.toBe(hashRecoveryCode(codes[1]));
  });

  it("encrypts the secret so that only the same server secret reads it, and a changed value is refused", () => {
    const stored = encryptSecret(RFC_SECRET, "server-secret");
    expect(stored).not.toContain(RFC_SECRET);
    expect(stored).not.toBe(encryptSecret(RFC_SECRET, "server-secret"));
    expect(decryptSecret(stored, "server-secret")).toBe(RFC_SECRET);
    expect(() => decryptSecret(stored, "another-secret")).toThrow();
    const parts = stored.split(".");
    expect(() => decryptSecret([parts[0], parts[1], parts[2], Buffer.from("tampered").toString("base64url")].join("."), "server-secret")).toThrow();
    expect(() => encryptSecret(RFC_SECRET, "")).toThrow(/not set/);
  });
});
