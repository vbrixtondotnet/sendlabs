import { describe, expect, it } from "vitest";
import { createUnsubscribeToken, readUnsubscribeToken, unsubscribeKey, unsubscribeLinks, type UnsubscribePayload } from "../../src/server/lib/unsubscribe";
import { maskEmail } from "../../src/server/services/unsubscribe";

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const OTHER_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 200 - i)));
const WHO: UnsubscribePayload = { tenantId: "t-1", email: "ada@example.test", campaignId: "c-1", test: false };

describe("unsubscribe tokens", () => {
  it("round-trip: what goes in comes out", async () => {
    expect(await readUnsubscribeToken(KEY, await createUnsubscribeToken(KEY, WHO))).toEqual(WHO);
  });
  it("carry a missing campaign, and the test flag", async () => {
    const t = { ...WHO, campaignId: null, test: true };
    expect(await readUnsubscribeToken(KEY, await createUnsubscribeToken(KEY, t))).toEqual(t);
  });
  it("are URL-safe: letters, digits, dash, underscore and one dot", async () => {
    const token = await createUnsubscribeToken(KEY, { ...WHO, email: "a+b/c?d=é@example.test" });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
  it("are the same for the same input (so a link can be rebuilt) and different for different recipients", async () => {
    expect(await createUnsubscribeToken(KEY, WHO)).toBe(await createUnsubscribeToken(KEY, WHO));
    expect(await createUnsubscribeToken(KEY, WHO)).not.toBe(await createUnsubscribeToken(KEY, { ...WHO, email: "grace@example.test" }));
    expect(await createUnsubscribeToken(KEY, WHO)).not.toBe(await createUnsubscribeToken(KEY, { ...WHO, test: true }));
  });
  it("cannot be read with another key", async () => {
    expect(await readUnsubscribeToken(OTHER_KEY, await createUnsubscribeToken(KEY, WHO))).toBeNull();
  });
  it("cannot be changed: a different address, tenant, or test flag breaks the signature", async () => {
    const token = await createUnsubscribeToken(KEY, WHO);
    const [, sig] = token.split(".") as [string, string];
    for (const other of [{ ...WHO, email: "grace@example.test" }, { ...WHO, tenantId: "t-2" }, { ...WHO, test: true }, { ...WHO, campaignId: "c-2" }]) {
      const [payload] = (await createUnsubscribeToken(KEY, other)).split(".") as [string];
      expect(await readUnsubscribeToken(KEY, `${payload}.${sig}`), JSON.stringify(other)).toBeNull(); // someone else's payload with this signature
    }
  });
  it("refuse a damaged signature, one character off", async () => {
    const token = await createUnsubscribeToken(KEY, WHO);
    const last = token.at(-1)!;
    expect(await readUnsubscribeToken(KEY, token.slice(0, -1) + (last === "A" ? "B" : "A"))).toBeNull();
  });
  it("refuse junk, without throwing: empty, no dot, extra dots, bad characters, too long", async () => {
    for (const junk of ["", ".", "abc", "a.b.c", "a.", ".b", "not base64!.sig", "é.é", "a b.c d", `${"a".repeat(2000)}.${"b".repeat(10)}`]) {
      expect(await readUnsubscribeToken(KEY, junk), JSON.stringify(junk).slice(0, 30)).toBeNull();
    }
  });
  it("refuse a validly signed token whose contents are not what we write (wrong shape)", async () => {
    // Sign arbitrary payloads with the real key to prove the shape check does not rely on the signature alone.
    const sign = async (obj: unknown) => {
      const payload = btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(KEY), (c) => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`sendrix-unsubscribe-v1.${payload}`)));
      return `${payload}.${btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
    };
    expect(await readUnsubscribeToken(KEY, await sign({ t: "t", e: "a@b.test", c: null, k: "l" }))).toEqual({ tenantId: "t", email: "a@b.test", campaignId: null, test: false }); // control: this shape is fine
    for (const bad of [{}, { t: 1, e: "a@b.test", c: null, k: "l" }, { t: "t", e: "", c: null, k: "l" }, { t: "t", e: "a@b.test", c: 5, k: "l" }, { t: "t", e: "a@b.test", c: null, k: "x" }, { t: "", e: "a@b.test", c: null, k: "l" }, { t: "t", e: "x".repeat(321), c: null, k: "l" }, []]) {
      expect(await readUnsubscribeToken(KEY, await sign(bad)), JSON.stringify(bad).slice(0, 40)).toBeNull();
    }
  });
  it("are not the same thing as another purpose's signature (the key is used for more than this)", async () => {
    const token = await createUnsubscribeToken(KEY, WHO);
    const [payload] = token.split(".") as [string];
    const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(KEY), (c) => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))); // signed WITHOUT the purpose label
    const plain = btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    expect(await readUnsubscribeToken(KEY, `${payload}.${plain}`)).toBeNull();
  });
  it("cannot be made with a key that is not 32 bytes", async () => {
    await expect(createUnsubscribeToken("c2hvcnQ=", WHO)).rejects.toThrow();
  });
});

describe("unsubscribeKey", () => {
  it("is the configured key when it is valid, and a 503 otherwise", () => {
    expect(unsubscribeKey({ TOKEN_ENCRYPTION_KEY: KEY })).toBe(KEY);
    for (const bad of [undefined, "", "short", "!!!"]) {
      expect(() => unsubscribeKey({ TOKEN_ENCRYPTION_KEY: bad })).toThrowError(expect.objectContaining({ status: 503, code: "UNSUBSCRIBE_NOT_CONFIGURED" }));
    }
  });
});

describe("unsubscribeLinks", () => {
  it("gives the page for the email body and the endpoint for the one-click header, both with the same token", () => {
    expect(unsubscribeLinks("https://app.example.com", "tok.sig")).toEqual({ page: "https://app.example.com/unsubscribe/tok.sig", oneClick: "https://app.example.com/api/unsubscribe/tok.sig" });
  });
  it("copes with a trailing slash on the app address", () => {
    expect(unsubscribeLinks("https://app.example.com/", "t.s").page).toBe("https://app.example.com/unsubscribe/t.s");
    expect(unsubscribeLinks("http://localhost:5173///", "t.s").oneClick).toBe("http://localhost:5173/api/unsubscribe/t.s");
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("ada@example.test")).toBe("a***@example.test");
    expect(maskEmail("x@y.test")).toBe("x***@y.test");
  });
  it("never shows more than that, even for odd input", () => {
    expect(maskEmail("")).toBe("***");
    expect(maskEmail("no-at-sign")).toBe("***");
    expect(maskEmail("@nolocal.test")).toBe("***");
    expect(maskEmail("a@b@c.test")).toBe("a***@c.test");
  });
});
