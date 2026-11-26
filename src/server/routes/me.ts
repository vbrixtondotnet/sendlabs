import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { MeDto } from "../../shared/api";
import { companyUpdateSchema, passwordChangeSchema, profileUpdateSchema } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { users } from "../database/schema";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/http";
import { AVATAR_EXTENSION, AVATAR_MAX_BYTES, sniffImage } from "../../shared/avatar";
import { newId, nowMs } from "../lib/id";
import { changePassword, updateCompany, updateProfile } from "../services/account";

/** Who is signed in, and the signed-in user managing their own account and its company details. */
export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", async (c) => {
  const a = c.get("actor");
  // Read fresh on every call (not from the session lookup), so the balance in the top bar is never stale.
  const [balance] = await c.get("db").select({ credits: users.credits, avatarKey: users.avatarKey, avatarUpdatedAt: users.avatarUpdatedAt }).from(users).where(eq(users.id, a.userId)).limit(1);
  const me: MeDto = {
    user: { id: a.userId, role: a.role, email: a.email, avatarUrl: balance?.avatarKey ? `/api/me/avatar?v=${balance.avatarUpdatedAt ?? 0}` : null, firstName: a.firstName, lastName: a.lastName, position: a.position, displayName: a.displayName, mustChangePassword: a.mustChangePassword, credits: balance?.credits ?? 0 },
    company: { name: a.companyName, postalAddress: a.postalAddress, website: a.website, requireUnsubscribeLink: a.requireUnsubscribeLink, oneClickUnsubscribe: a.oneClickUnsubscribe },
    session: a.viaSession,
  };
  return c.json(me);
});

/** Edit your own first name, last name and position. Always your own account: there is no id to pass. */
meRoutes.patch("/", async (c) => {
  const body = await parseJson(c, profileUpdateSchema);
  return c.json(await updateProfile(c.get("db"), c.get("actor"), body));
});

/** Edit your own company details (the name and address its emails carry, and the unsubscribe settings). Always your own account. */
meRoutes.patch("/company", async (c) => {
  const body = await parseJson(c, companyUpdateSchema);
  return c.json(await updateCompany(c.get("db"), c.get("actor").userId, body));
});

/** Change your own password (needs the current one). Ends your other sessions. */
meRoutes.post("/password", async (c) => {
  const body = await parseJson(c, passwordChangeSchema);
  c.header("Cache-Control", "no-store");
  try {
    await changePassword(c.get("db"), c.get("actor"), body);
  } catch (e) {
    if (e instanceof ApiError && e.code === "TOO_MANY_ATTEMPTS") c.header("Retry-After", String((e.details as { retryAfterSeconds: number }).retryAfterSeconds));
    throw e;
  }
  return c.body(null, 204);
});

/**
 * The profile picture. Stored in Cloudflare R2 under a key of its own (never the file's name), and only an image: the bytes are read for
 * what they really are (JPEG, PNG, WebP or GIF), never the browser's claim, and anything else is refused. At most AVATAR_MAX_BYTES. Always
 * the signed-in account's own picture: there is no id to pass.
 */
meRoutes.put("/avatar", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Send the picture as a form with a file");
  }
  const unknown = [...new Set([...form.keys()])].filter((k) => k !== "file");
  if (unknown.length > 0) throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", unknown.map((k) => ({ path: k, message: "This field is not accepted" })));
  const file = form.get("file");
  if (typeof file === "string" || file === null) throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", [{ path: "file", message: "Choose a picture" }]);
  if (file.size > AVATAR_MAX_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", `The picture must be at most ${AVATAR_MAX_BYTES / 1024 / 1024} MB`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", [{ path: "file", message: "Choose an image file (JPG, PNG, WebP or GIF)" }]);

  const a = c.get("actor");
  const store = c.get("objects")();
  const db = c.get("db");
  const key = `avatars/${a.userId}/${newId()}.${AVATAR_EXTENSION[type]}`;
  const [before] = await db.select({ avatarKey: users.avatarKey }).from(users).where(eq(users.id, a.userId)).limit(1);
  await store.put(key, bytes, type);
  const at = nowMs();
  await db.update(users).set({ avatarKey: key, avatarUpdatedAt: at, updatedAt: at }).where(eq(users.id, a.userId));
  if (before?.avatarKey) await store.delete(before.avatarKey).catch(() => undefined); // the old one is no longer used
  c.header("Cache-Control", "no-store");
  return c.json({ avatarUrl: `/api/me/avatar?v=${at}` });
});

/** The picture itself, for the signed-in account only. The address carries `?v=` (when it last changed), so a browser keeps it until it changes. */
meRoutes.get("/avatar", async (c) => {
  const [row] = await c.get("db").select({ avatarKey: users.avatarKey }).from(users).where(eq(users.id, c.get("actor").userId)).limit(1);
  if (!row?.avatarKey) throw new ApiError(404, "NOT_FOUND", "No profile picture");
  const object = await c.get("objects")().get(row.avatarKey);
  if (!object) throw new ApiError(404, "NOT_FOUND", "No profile picture");
  return new Response(object.body as BodyInit, {
    headers: {
      "content-type": object.contentType,
      "content-length": String(object.size),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "content-disposition": "inline",
    },
  });
});

/** Removes the picture (the top bar goes back to initials). */
meRoutes.delete("/avatar", async (c) => {
  const a = c.get("actor");
  const db = c.get("db");
  const [row] = await db.select({ avatarKey: users.avatarKey }).from(users).where(eq(users.id, a.userId)).limit(1);
  await db.update(users).set({ avatarKey: null, avatarUpdatedAt: null, updatedAt: nowMs() }).where(eq(users.id, a.userId));
  if (row?.avatarKey) await c.get("objects")().delete(row.avatarKey).catch(() => undefined);
  return c.body(null, 204);
});
