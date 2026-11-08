import { Hono } from "hono";
import type { AppEnv } from "../app";
import { usersRepo } from "../database/repositories/users";
import { parseQuery } from "../lib/http";
import { requireAccess } from "../middleware/auth";
import { invitationCreateSchema, userListQuery } from "../../shared/schemas";
import { invitationsRepo } from "../database/repositories/invitations";
import { googleConfig } from "../services/google-oauth";
import { createInvitation, resendInvitation, revokeInvitation } from "../services/invitations";
import { removeUser } from "../services/users";
import { parseJson } from "../lib/http";

/**
 * The people in the caller's tenant, and invitations to add more. Administrators only, because user management
 * is an Administrator power. Changing access and disabling users are not built yet.
 */
export const userRoutes = new Hono<AppEnv>();

userRoutes.use("*", requireAccess("Administrator"));

userRoutes.get("/", async (c) => {
  const q = parseQuery(c, userListQuery);
  return c.json(await usersRepo(c.get("db"), c.get("actor").tenantId).list(q.page, q.pageSize));
});

/** Removes a user from the tenant. Soft delete: the row stays, flagged IsDeleted, and they can be invited again later. */
userRoutes.delete("/:id", async (c) => {
  await removeUser(c.get("db"), c.get("actor"), c.req.param("id"));
  return c.body(null, 204);
});

/* ------------------------------ invitations ------------------------------ */

/** Open invitations (waiting for an answer, or expired and waiting to be resent). */
userRoutes.get("/invitations", async (c) => c.json({ items: await invitationsRepo(c.get("db"), c.get("actor").tenantId).list() }));

/** Invites someone and emails them, through the tenant's connected Gmail account. */
userRoutes.post("/invitations", async (c) => {
  const body = await parseJson(c, invitationCreateSchema);
  const dto = await createInvitation({ db: c.get("db"), google: c.get("google"), cfg: googleConfig(c.env) }, c.get("actor"), body);
  return c.json(dto, 201);
});

/** Sends a fresh link. The earlier link stops working. */
userRoutes.post("/invitations/:id/resend", async (c) => {
  const dto = await resendInvitation({ db: c.get("db"), google: c.get("google"), cfg: googleConfig(c.env) }, c.get("actor"), c.req.param("id"));
  return c.json(dto, 201);
});

/** Withdraws an invitation. Its link stops working. */
userRoutes.delete("/invitations/:id", async (c) => {
  await revokeInvitation(c.get("db"), c.get("actor").tenantId, c.req.param("id"));
  return c.body(null, 204);
});
