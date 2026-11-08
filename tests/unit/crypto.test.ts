import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isValidEncryptionKey, randomToken, sha256Base64Url } from "../../src/server/lib/crypto";

const key = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const otherKey = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 200 - i)));

describe("random tokens", () => {
  it("are URL-safe, long enough to be unguessable, and never repeat", () => {
    const tokens = Array.from({ length: 500 }, () => randomToken());
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes = 256 bits
    expect(new Set(tokens).size).toBe(500);
    expect(randomToken(48)).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });
});

describe("sha256Base64Url (PKCE)", () => {
  it("matches the published SHA-256 value for 'abc'", async () => {
    expect(await sha256Base64Url("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });
  it("matches the test vector in RFC 7636 appendix B (verifier -> S256 challenge)", async () => {
    expect(await sha256Base64Url("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("encryption key", () => {
  it("must be exactly 32 bytes of base64", () => {
    expect(isValidEncryptionKey(key)).toBe(true);
    for (const bad of [undefined, "", "short", btoa("x".repeat(16)), btoa("x".repeat(33)), "not base64!!!", "abc$def"]) {
      expect(isValidEncryptionKey(bad), String(bad)).toBe(false);
    }
  });
});

describe("encryptSecret / decryptSecret (AES-256-GCM)", () => {
  it("round-trips, including unicode, and the output hides the plaintext", async () => {
    for (const secret of ["1//0g-refresh-token_value", "", "pässwörd 日本語 🔑", "x".repeat(5000)]) {
      const sealed = await encryptSecret(secret, key, "ctx");
      expect(await decryptSecret(sealed, key, "ctx")).toBe(secret);
      if (secret.length > 3) expect(sealed).not.toContain(secret);
    }
  });

  it("has a versioned format and a fresh IV every time", async () => {
    const [a, b] = await Promise.all([encryptSecret("same", key, "ctx"), encryptSecret("same", key, "ctx")]);
    expect(a).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
  });

  it("will not decrypt under the wrong key", async () => {
    const sealed = await encryptSecret("secret", key, "ctx");
    await expect(decryptSecret(sealed, otherKey, "ctx")).rejects.toThrow("Could not decrypt");
  });

  it("is bound to its context: the same ciphertext is useless for another tenant", async () => {
    const sealed = await encryptSecret("secret", key, "sender-refresh-token:tenant-a");
    expect(await decryptSecret(sealed, key, "sender-refresh-token:tenant-a")).toBe("secret");
    await expect(decryptSecret(sealed, key, "sender-refresh-token:tenant-b")).rejects.toThrow("Could not decrypt");
    await expect(decryptSecret(sealed, key, "")).rejects.toThrow("Could not decrypt");
  });

  it("detects tampering with any part", async () => {
    const [v, iv, ct] = (await encryptSecret("secret", key, "ctx")).split(".") as [string, string, string];
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    for (const bad of [`${v}.${flip(iv)}.${ct}`, `${v}.${iv}.${flip(ct)}`, `${v}.${iv}.${ct.slice(0, -4)}AAAA`]) {
      await expect(decryptSecret(bad, key, "ctx")).rejects.toThrow("Could not decrypt");
    }
  });

  it("gives the same generic error for every malformed input", async () => {
    for (const bad of ["", "plain", "v2.a.b", "v1.a", "v1.a.b.c", "v1..", "v1.!!!.???"]) {
      await expect(decryptSecret(bad, key, "ctx"), JSON.stringify(bad)).rejects.toThrow("Could not decrypt the stored secret");
    }
  });

  it("refuses to encrypt with a bad key", async () => {
    await expect(encryptSecret("x", "short", "ctx")).rejects.toThrow("32 bytes");
  });
});
