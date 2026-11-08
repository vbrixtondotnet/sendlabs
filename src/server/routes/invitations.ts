import { Hono } from "hono";
import type { AppEnv } from "../app";
import { parseJson } from "../lib/http";
import { setSessionCookie } from "../lib/session";
import { acceptInvitation, previewInvitation } from "../services/invitations";
import { acceptInvitationSchema } from "../../shared/schemas";

/**
 * PUBLIC: the invited person has no account yet, so there is no one to sign in as. The secret in the link is the
 * only credential, it is single-use, and every way it can be unusable (unknown, expired, used, revoked, suspended
 * tenant) gets the same answer, so a stranger learns nothing by guessing.
 */
export const invitationPublicRoutes = new Hono<AppEnv>();

/** What the invitation page greets the person with. */
invitationPublicRoutes.get("/:token", async (c) => c.json(await previewInvitation(c.get("db"), c.req.param("token"))));

/** Sets the password, activates the user in the inviting tenant, and signs them in (session cookie). */
invitationPublicRoutes.post("/:token/accept", async (c) => {
  const { password } = await parseJson(c, acceptInvitationSchema);
  const { sessionToken, expiresAt } = await acceptInvitation(c.get("db"), c.req.param("token"), password);
  setSessionCookie(c, sessionToken, expiresAt);
  c.header("Cache-Control", "no-store");
  return c.json({ redirectTo: "/" });
});
