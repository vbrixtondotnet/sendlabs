import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AVATAR_MAX_BYTES, sniffImage } from "../../src/shared/avatar";
import { memoryStore } from "../../src/server/lib/object-store";
import { startHarness, type Caller, type Harness } from "./harness";

const store = memoryStore();
let h: Harness;
beforeAll(async () => { h = await startHarness({ objects: store }); });
afterAll(async () => { await h.dispose(); });

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3, 4];
const JPG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 9, 9];
const file = (bytes: number[], name: string, type: string) => new File([new Uint8Array(bytes)], name, { type });
const put = (who: Caller, f: File, extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.append("file", f, f.name);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return who.sendForm("PUT", "/api/me/avatar", form);
};
const meOf = async (who: Caller) => (await who.api("GET", "/api/me")).json.user;
const avatarKeys = () => store.keys().filter((k) => k.startsWith("avatars/"));

describe("what counts as an image", () => {
  it("reads the real bytes: JPEG, PNG, GIF and WebP only", () => {
    expect([JPG, PNG, GIF, WEBP].map((b) => sniffImage(new Uint8Array(b)))).toEqual(["image/jpeg", "image/png", "image/gif", "image/webp"]);
    for (const bad of [[0x3c, 0x73, 0x76, 0x67], [0x25, 0x50, 0x44, 0x46], [0x50, 0x4b, 0x03, 0x04], [], [1, 2, 3]]) expect(sniffImage(new Uint8Array(bad))).toBeNull();
  });
});

describe("the profile picture: PUT/GET/DELETE /api/me/avatar", () => {
  it("has no picture at first", async () => {
    expect((await meOf(h.jobSeeker)).avatarUrl).toBeNull();
    expect((await h.jobSeeker.api("GET", "/api/me/avatar")).status).toBe(404);
  });

  it("stores an uploaded image in the object store (R2), shows it in /api/me and serves it back, privately", async () => {
    const r = await put(h.jobSeeker, file(PNG, "me.png", "image/png"));
    expect(r.status).toBe(200);
    expect(r.json.avatarUrl).toMatch(/^\/api\/me\/avatar\?v=\d+$/);
    expect((await meOf(h.jobSeeker)).avatarUrl).toBe(r.json.avatarUrl);
    expect(avatarKeys()).toHaveLength(1);
    const g = await h.jobSeeker.text("/api/me/avatar");
    expect(g.status).toBe(200);
    expect(g.headers.get("content-type")).toBe("image/png");
    expect(g.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(g.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await h.anonymous.api("GET", "/api/me/avatar")).status).toBe(401);
  });

  it("names the object by a key of its own, never by the file's name", () => {
    const key = avatarKeys()[0]!;
    expect(key).toMatch(/^avatars\/[^/]+\/[0-9a-f-]+\.png$/);
    expect(key).not.toContain("me.png");
  });

  it("replaces the picture and deletes the old object; each account has its own", async () => {
    const first = avatarKeys()[0]!;
    expect((await put(h.jobSeeker, file(JPG, "next.jpg", "image/jpeg"))).status).toBe(200);
    const keys = avatarKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe(first);
    expect((await h.jobSeeker.text("/api/me/avatar")).headers.get("content-type")).toBe("image/jpeg");
    expect((await meOf(h)).avatarUrl).toBeNull(); // another account has none
    expect((await h.api("GET", "/api/me/avatar")).status).toBe(404);
  });

  it("accepts GIF and WebP for any role", async () => {
    expect((await put(h, file(GIF, "a.gif", "image/gif"))).status).toBe(200);
    expect((await put(h.superAdmin, file(WEBP, "a.webp", "image/webp"))).status).toBe(200);
  });

  it("refuses anything that is not an image, whatever the file is called or the browser says", async () => {
    const before = store.keys().length;
    for (const f of [
      file([0x3c, 0x73, 0x76, 0x67, 0x3e], "evil.svg", "image/svg+xml"),
      file([0x25, 0x50, 0x44, 0x46, 0x2d], "doc.pdf", "application/pdf"),
      file([0x68, 0x65, 0x6c, 0x6c, 0x6f], "fake.png", "image/png"), // text pretending to be a PNG
      file([0x4d, 0x5a, 0x90, 0x00], "app.exe.png", "image/png"),
      file([], "empty.png", "image/png"),
    ]) {
      const r = await put(h.jobSeeker, f);
      expect(r.status, f.name).toBe(400);
      expect(r.json.error.details[0].path).toBe("file");
    }
    expect(store.keys()).toHaveLength(before);
  });

  it("refuses a picture over the limit (413), an unknown field, a missing file and a cross-site request", async () => {
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1).fill(1);
    big.set(PNG);
    expect((await put(h.jobSeeker, new File([big], "big.png", { type: "image/png" }))).status).toBe(413);
    expect((await put(h.jobSeeker, file(PNG, "a.png", "image/png"), { userId: "someone-else" })).status).toBe(400);
    expect((await h.jobSeeker.sendForm("PUT", "/api/me/avatar", new FormData())).status).toBe(400);
    const form = new FormData();
    form.append("file", file(PNG, "a.png", "image/png"));
    expect((await h.jobSeeker.sendForm("PUT", "/api/me/avatar", form, { origin: "https://evil.test" })).status).toBe(403);
  });

  it("removes the picture from the account and from the store", async () => {
    expect((await put(h.jobSeeker, file(PNG, "again.png", "image/png"))).status).toBe(200);
    const before = store.keys().length;
    expect((await h.jobSeeker.api("DELETE", "/api/me/avatar")).status).toBe(204);
    expect((await meOf(h.jobSeeker)).avatarUrl).toBeNull();
    expect((await h.jobSeeker.api("GET", "/api/me/avatar")).status).toBe(404);
    expect(store.keys().length).toBe(before - 1);
  });

  it("needs a session", async () => {
    expect((await h.anonymous.sendForm("PUT", "/api/me/avatar", new FormData())).status).toBe(401);
    expect((await h.anonymous.api("DELETE", "/api/me/avatar")).status).toBe(401);
  });
});

describe("with no bucket configured", () => {
  it("answers 503 STORAGE_NOT_CONFIGURED instead of failing", async () => {
    const bare = await startHarness();
    try {
      const r = await put(bare.jobSeeker, file(PNG, "a.png", "image/png"));
      expect(r.status).toBe(503);
      expect(r.json.error.code).toBe("STORAGE_NOT_CONFIGURED");
    } finally {
      await bare.dispose();
    }
  });
});
