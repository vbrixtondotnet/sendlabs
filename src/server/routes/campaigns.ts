import { Hono } from "hono";
import type { AppEnv } from "../app";
import { campaignsRepo } from "../database/repositories/campaigns";
import { ApiError } from "../lib/errors";
import { unsubscribeConfig } from "../lib/unsubscribe";
import { parseJson, parseQuery } from "../lib/http";
import type { Actor } from "../middleware/auth";
import { emailProviderForRequest } from "../services/email-providers";
import { launchCampaign, retryFailedRecipients } from "../services/campaign-launch";
import { runCampaignTick } from "../services/campaign-sender";
import { googleConfig } from "../services/google-oauth";
import { tickDepsFor } from "../services/scheduled";
import { z } from "zod";
import { sendTestEmail } from "../services/test-send";
import {
  campaignCreateSchema,
  campaignListQuery,
  campaignPatchSchema,
  recipientListQuery,
  testSendSchema,
} from "../../shared/schemas";
import type { CampaignAction } from "../../shared/status";

/**
 * Launch starts a Draft sending (the scheduled sender then sends a little at a time inside the campaign's daily window and
 * limit), and retry-failed sends the failed ones again. Pause, resume and cancel work on any campaign in a legal state.
 */
export const campaignRoutes = new Hono<AppEnv>();

campaignRoutes.get("/", async (c) => {
  const query = parseQuery(c, campaignListQuery);
  return c.json(await campaignsRepo(c.get("db"), c.get("actor").userId).list(query));
});

campaignRoutes.post("/", async (c) => {
  const body = await parseJson(c, campaignCreateSchema);
  return c.json(await campaignsRepo(c.get("db"), c.get("actor").userId).create(body), 201);
});

campaignRoutes.get("/:id", async (c) => c.json(await campaignsRepo(c.get("db"), c.get("actor").userId).get(c.req.param("id"))));

campaignRoutes.patch("/:id", async (c) => {
  const patch = await parseJson(c, campaignPatchSchema);
  return c.json(await campaignsRepo(c.get("db"), c.get("actor").userId).updateDraft(c.req.param("id"), patch));
});

campaignRoutes.delete("/:id", async (c) => {
  await campaignsRepo(c.get("db"), c.get("actor").userId).deleteDraft(c.req.param("id"));
  return c.body(null, 204);
});

campaignRoutes.post("/:id/duplicate", async (c) =>
  c.json(await campaignsRepo(c.get("db"), c.get("actor").userId).duplicate(c.req.param("id")), 201),
);

/**
 * Mails the campaign to the test-send allowlist (Settings), never to its real recipients, and does not change its
 * status. A test can only go where the account allowed it to: the request may choose among the allowlisted addresses, never add one.
 */
/** What the sending code needs to know about the caller: who they are, and the company details their emails carry. */
const companyOf = (a: Actor) => ({
  userId: a.userId,
  companyName: a.companyName,
  senderName: a.displayName,
  postalAddress: a.postalAddress,
});

campaignRoutes.post("/:id/test-send", async (c) => {
  // The body is optional: `{ to: [...] }` picks some of the allowlisted addresses, nothing means all of them.
  const hasBody = (await c.req.text()).trim() !== "";
  const only = hasBody ? (await parseJson(c, testSendSchema)).to : undefined;
  const cfg = googleConfig(c.env);
  const email = emailProviderForRequest(c); // the same provider as one-to-one email
  const unsubscribe = unsubscribeConfig(c.env, cfg);
  return c.json(await sendTestEmail({ db: c.get("db"), email, unsubscribe }, companyOf(c.get("actor")), c.req.param("id"), only));
});

/**
 * Launches a Draft campaign: checks everything (subject and message, postal address, a working sender, someone to send to),
 * freezes the recipient list, and makes it Sending. Nothing is sent by this request.
 */
campaignRoutes.post("/:id/launch", async (c) =>
  c.json(await launchCampaign({ db: c.get("db"), email: emailProviderForRequest(c) }, c.get("actor").userId, c.req.param("id"))),
);

/** Puts the recipients that failed back in line to be sent again. */
campaignRoutes.post("/:id/retry-failed", async (c) =>
  c.json(await retryFailedRecipients({ db: c.get("db") }, c.get("actor").userId, c.req.param("id"))),
);

/**
 * LOCAL DEVELOPMENT ONLY: runs one pass of the sender now, instead of waiting for the Cron Trigger (which `vite` does not run).
 * `{ now }` pretends it is another time, to try the send window. Any other environment answers 404.
 */
campaignRoutes.post("/run-tick", async (c) => {
  if (c.env.ENVIRONMENT !== "local") throw new ApiError(404, "NOT_FOUND", "Not found");
  const raw = await c.req.text();
  const { now } = raw.trim() ? await parseJson(c, z.strictObject({ now: z.number().int().positive().optional() })) : { now: undefined };
  const deps = tickDepsFor(c.env, { db: c.get("db"), google: c.get("google"), fetch: c.get("fetch") });
  return c.json(await runCampaignTick(deps, now ?? Date.now()));
});

campaignRoutes.post("/:id/archive", async (c) => c.json(await campaignsRepo(c.get("db"), c.get("actor").userId).setArchived(c.req.param("id"), true)));
campaignRoutes.post("/:id/unarchive", async (c) => c.json(await campaignsRepo(c.get("db"), c.get("actor").userId).setArchived(c.req.param("id"), false)));

for (const action of ["pause", "resume", "cancel"] as const satisfies readonly CampaignAction[]) {
  campaignRoutes.post(`/:id/${action}`, async (c) =>
    c.json(await campaignsRepo(c.get("db"), c.get("actor").userId).applyAction(c.req.param("id"), action)),
  );
}

campaignRoutes.get("/:id/recipients", async (c) => {
  const query = parseQuery(c, recipientListQuery);
  return c.json(await campaignsRepo(c.get("db"), c.get("actor").userId).listRecipients(c.req.param("id"), query));
});
