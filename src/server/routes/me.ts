import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { MeDto } from "../../shared/api";
import { companyUpdateSchema, passwordChangeSchema, profileUpdateSchema } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { users } from "../database/schema";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/http";
import { changePassword, updateCompany, updateProfile } from "../services/account";

/** Who is signed in, and the signed-in user managing their own account and its company details. */
export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", async (c) => {
  const a = c.get("actor");
  // Read fresh on every call (not from the session lookup), so the balance in the top bar is never stale.
  const [balance] = await c.get("db").select({ credits: users.credits }).from(users).where(eq(users.id, a.userId)).limit(1);
  const me: MeDto = {
    user: { id: a.userId, role: a.role, email: a.email, firstName: a.firstName, lastName: a.lastName, position: a.position, displayName: a.displayName, mustChangePassword: a.mustChangePassword, credits: balance?.credits ?? 0 },
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
