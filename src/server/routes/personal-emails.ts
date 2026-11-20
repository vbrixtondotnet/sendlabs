import { Hono } from "hono";
import { personalEmailCreateSchema } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { parseJson } from "../lib/http";
import { requireAccess } from "../middleware/auth";
import { emailProviderForRequest } from "../services/email-providers";
import { listPersonalEmails, sendPersonalEmail } from "../services/personal-email";

/**
 * One-to-one email: a message a person writes to one person, sent through the organization's connected Gmail account (the same
 * provider a campaign's test send uses).
 * Administrators and Campaign Managers only. Plain text, no unsubscribe footer; for lists, use a campaign.
 */
export const personalEmailRoutes = new Hono<AppEnv>();

personalEmailRoutes.use("*", requireAccess("Administrator", "Campaign Manager"));

personalEmailRoutes.get("/", async (c) => c.json(await listPersonalEmails(c.get("db"), c.get("actor").tenantId, emailProviderForRequest(c).id)));

personalEmailRoutes.post("/", async (c) => {
  const input = await parseJson(c, personalEmailCreateSchema);
  const actor = c.get("actor");
  const email = emailProviderForRequest(c); // the same provider as a campaign's test send
  const sent = await sendPersonalEmail({ db: c.get("db"), email }, { tenantId: actor.tenantId, userId: actor.userId, senderName: actor.displayName }, input);
  return c.json(sent, 201);
});
