import { Hono } from "hono";
import type { MeDto } from "../../shared/api";
import { passwordChangeSchema, profileUpdateSchema } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/http";
import { changePassword, updateProfile } from "../services/account";

/** Who is signed in and which tenant they belong to, and the signed-in user managing their own account. */
export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", (c) => {
  const a = c.get("actor");
  const me: MeDto = {
    user: { id: a.userId, email: a.email, firstName: a.firstName, lastName: a.lastName, position: a.position, displayName: a.displayName, access: a.access, mustChangePassword: a.mustChangePassword },
    tenant: { id: a.tenantId, name: a.tenantName, slug: a.tenantSlug, postalAddress: a.tenantPostalAddress, website: a.tenantWebsite, requireUnsubscribeLink: a.tenantRequireUnsubscribeLink, oneClickUnsubscribe: a.tenantOneClickUnsubscribe },
    session: a.viaSession,
  };
  return c.json(me);
});

/** Edit your own first name, last name and position. Always your own account: there is no id to pass. */
meRoutes.patch("/", async (c) => {
  const body = await parseJson(c, profileUpdateSchema);
  return c.json(await updateProfile(c.get("db"), c.get("actor"), body));
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
