import { Hono } from "hono";
import type { AppEnv } from "../app";
import { campaignsRepo } from "../database/repositories/campaigns";
import { parseJson, parseQuery } from "../lib/http";
import { requireAccess, type Actor } from "../middleware/auth";
import { googleConfig } from "../services/google-oauth";
import { sendTestEmail } from "../services/test-send";
import {
  campaignCreateSchema,
  campaignListQuery,
  campaignPatchSchema,
  recipientListQuery,
} from "../../shared/schemas";
import type { CampaignAction } from "../../shared/status";

/**
 * Launch and retry-failed are not here yet: they need the suppression list and queue. Pause, resume and cancel work on any campaign in a legal state.
 */
export const campaignRoutes = new Hono<AppEnv>();

campaignRoutes.get("/", async (c) => {
  const query = parseQuery(c, campaignListQuery);
  return c.json(await campaignsRepo(c.get("db"), c.get("actor").tenantId).list(query));
});

campaignRoutes.post("/", async (c) => {
  const body = await parseJson(c, campaignCreateSchema);
  return c.json(await campaignsRepo(c.get("db"), c.get("actor").tenantId).create(body, { id: c.get("actor").userId, email: c.get("actor").email }), 201);
});

campaignRoutes.get("/:id", async (c) => c.json(await campaignsRepo(c.get("db"), c.get("actor").tenantId).get(c.req.param("id"))));

campaignRoutes.patch("/:id", async (c) => {
  const patch = await parseJson(c, campaignPatchSchema);
  return c.json(await campaignsRepo(c.get("db"), c.get("actor").tenantId).updateDraft(c.req.param("id"), patch));
});

campaignRoutes.delete("/:id", async (c) => {
  await campaignsRepo(c.get("db"), c.get("actor").tenantId).deleteDraft(c.req.param("id"));
  return c.body(null, 204);
});

campaignRoutes.post("/:id/duplicate", async (c) =>
  c.json(await campaignsRepo(c.get("db"), c.get("actor").tenantId).duplicate(c.req.param("id"), { id: c.get("actor").userId, email: c.get("actor").email }), 201),
);

/**
 * Mails the campaign to the test-send allowlist (Settings), never to its real recipients, and does not change its
 * status. The request carries no addresses: a test can only go where an Administrator allowed it to.
 */
/** What the sending code needs to know about the caller's organization. */
const tenantOf = (a: Actor) => ({
  tenantId: a.tenantId,
  tenantName: a.tenantName,
  senderName: a.displayName,
  postalAddress: a.tenantPostalAddress,
  requireUnsubscribeLink: a.tenantRequireUnsubscribeLink,
  oneClickUnsubscribe: a.tenantOneClickUnsubscribe,
});

campaignRoutes.post("/:id/test-send", requireAccess("Administrator", "Campaign Manager"), async (c) =>
  c.json(await sendTestEmail({ db: c.get("db"), google: c.get("google"), cfg: googleConfig(c.env) }, tenantOf(c.get("actor")), c.req.param("id"))),
);

campaignRoutes.post("/:id/archive", async (c) => c.json(await campaignsRepo(c.get("db"), c.get("actor").tenantId).setArchived(c.req.param("id"), true)));
campaignRoutes.post("/:id/unarchive", async (c) => c.json(await campaignsRepo(c.get("db"), c.get("actor").tenantId).setArchived(c.req.param("id"), false)));

for (const action of ["pause", "resume", "cancel"] as const satisfies readonly CampaignAction[]) {
  campaignRoutes.post(`/:id/${action}`, async (c) =>
    c.json(await campaignsRepo(c.get("db"), c.get("actor").tenantId).applyAction(c.req.param("id"), action)),
  );
}

campaignRoutes.get("/:id/recipients", async (c) => {
  const query = parseQuery(c, recipientListQuery);
  return c.json(await campaignsRepo(c.get("db"), c.get("actor").tenantId).listRecipients(c.req.param("id"), query));
});
