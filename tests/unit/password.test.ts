import { describe, expect, it } from "vitest";
import {
  hashPassword,
  needsRehash,
  passwordProblem,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PBKDF2_ITERATIONS,
  verifyPassword,
} from "../../src/server/lib/password";
import { slugify } from "../../src/server/services/tenants";

describe("password hashing", () => {
  it("produces a self-describing PBKDF2 hash that never contains the password", async () => {
    const stored = await hashPassword("Password@123");
    const [scheme, iterations, salt, hash, extra] = stored.split("$");
    expect(scheme).toBe("pbkdf2-sha256");
    expect(Number(iterations)).toBe(PBKDF2_ITERATIONS);
    expect(extra).toBeUndefined();
    expect(atob(salt!)).toHaveLength(16);
    expect(atob(hash!)).toHaveLength(32);
    expect(stored).not.toContain("Password@123");
  });

  it("stays within the 100,000-iteration ceiling Cloudflare Workers enforce", () => {
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(100_000);
  });

  it("verifies the right password and refuses a wrong one", async () => {
    const stored = await hashPassword("Password@123");
    expect(await verifyPassword("Password@123", stored)).toBe(true);
    expect(await verifyPassword("Password@124", stored)).toBe(false);
    expect(await verifyPassword("password@123", stored)).toBe(false); // case matters
    expect(await verifyPassword("Password@123 ", stored)).toBe(false); // whitespace matters
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts every hash, so equal passwords never produce equal hashes", async () => {
    const [one, two] = await Promise.all([hashPassword("Same-Password-1"), hashPassword("Same-Password-1")]);
    expect(one).not.toBe(two);
    expect(await verifyPassword("Same-Password-1", one)).toBe(true);
    expect(await verifyPassword("Same-Password-1", two)).toBe(true);
  });

  it("treats the same visible password the same however it was typed (Unicode NFKC)", async () => {
    const stored = await hashPassword("Password1");
    expect(await verifyPassword("Ｐassword1", stored)).toBe(true); // full-width P
    const accented = await hashPassword("café-Pass1"); // é as one character
    expect(await verifyPassword("café-Pass1", accented)).toBe(true); // e + combining accent
  });

  it("rejects an oversized password without hashing it", async () => {
    const stored = await hashPassword("Password@123");
    expect(await verifyPassword("x".repeat(PASSWORD_MAX_LENGTH + 1), stored)).toBe(false);
  });

  it("returns false (never throws) for any malformed stored value", async () => {
    const good = await hashPassword("Password@123");
    const [scheme, iter, salt, hash] = good.split("$");
    const bad = [
      "", "plaintext", "$$$", "bcrypt$10$abc$def",
      `${scheme}$${iter}$${salt}`, // missing the hash
      `${good}$extra`, // too many parts
      `${scheme}$abc$${salt}$${hash}`, // non-numeric iterations
      `${scheme}$0$${salt}$${hash}`,
      `${scheme}$-5$${salt}$${hash}`,
      `${scheme}$1.5$${salt}$${hash}`,
      `${scheme}$99999999$${salt}$${hash}`, // absurd cost: refused rather than burning CPU
      `${scheme}$${iter}$!!!notbase64!!!$${hash}`,
      `${scheme}$${iter}$${salt}$${btoa("short")}`, // hash of the wrong length
      `${scheme}$${iter}$$${hash}`, // empty salt
    ];
    for (const stored of bad) expect(await verifyPassword("Password@123", stored), JSON.stringify(stored)).toBe(false);
  });

  it("verifies hashes made with a different iteration count, and flags them for re-hashing", async () => {
    const cheap = await hashPassword("Password@123", 1_000);
    expect(cheap.split("$")[1]).toBe("1000");
    expect(await verifyPassword("Password@123", cheap)).toBe(true);
    expect(needsRehash(cheap)).toBe(true);
    expect(needsRehash(await hashPassword("Password@123"))).toBe(false);
    expect(needsRehash("garbage")).toBe(true);
  });
});

describe("password rules", () => {
  it("checks length only", () => {
    expect(passwordProblem("Password@123")).toBeNull();
    expect(passwordProblem("a".repeat(PASSWORD_MIN_LENGTH))).toBeNull();
    expect(passwordProblem("a".repeat(PASSWORD_MIN_LENGTH - 1))).toMatch(/at least/);
    expect(passwordProblem("")).toMatch(/at least/);
    expect(passwordProblem("a".repeat(PASSWORD_MAX_LENGTH))).toBeNull();
    expect(passwordProblem("a".repeat(PASSWORD_MAX_LENGTH + 1))).toMatch(/at most/);
  });
});

describe("tenant slugs", () => {
  it("makes URL-safe identifiers", () => {
    expect(slugify("Sabertooth Software Labs")).toBe("sabertooth-software-labs");
    expect(slugify("  Globex   Corp.  ")).toBe("globex-corp");
    expect(slugify("Café Münster & Söhne")).toBe("cafe-munster-sohne");
    expect(slugify("A--B__C")).toBe("a-b-c");
  });
  it("always returns something valid, even for names with no letters or digits", () => {
    expect(slugify("!!!")).toBe("tenant");
    expect(slugify("")).toBe("tenant");
    expect(slugify("日本語")).toBe("tenant");
  });
  it("caps the length without leaving a trailing hyphen", () => {
    const s = slugify(`${"a".repeat(49)} bbbbbbbb`);
    expect(s.length).toBeLessThanOrEqual(50);
    expect(s.endsWith("-")).toBe(false);
    expect(s).toMatch(/^[a-z0-9-]+$/);
  });
});
