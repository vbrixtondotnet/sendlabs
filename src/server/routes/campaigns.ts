import { Hono } from "hono";
import type { AppEnv } from "../app";
import { campaignsRepo } from "../database/repositories/campaigns";
import { parseJson, parseQuery } from "../lib/http";
import {
  campaignCreateSchema,
  campaignListQuery,
  campaignPatchSchema,
  recipientListQuery,
} from "../../shared/schemas";
import type { CampaignAction } from "../../shared/status";

/**
 * Launch, test-send and retry-failed are not here yet: they need the sender account,
 * suppression list and queue. Pause, resume and cancel work on any campaign in a legal state.
 */
export const campaignRoutes = new Hono<AppEnv>();

campaignRoutes.get("/", async (c) => {
  const query = parseQuery(c, campaignListQuery);
  return c.json(await campaignsRepo(c.get("db")).list(query));
});

campaignRoutes.post("/", async (c) => {
  const body = await parseJson(c, campaignCreateSchema);
  return c.json(await campaignsRepo(c.get("db")).create(body, c.get("actor").email), 201);
});

campaignRoutes.get("/:id", async (c) => c.json(await campaignsRepo(c.get("db")).get(c.req.param("id"))));

campaignRoutes.patch("/:id", async (c) => {
  const patch = await parseJson(c, campaignPatchSchema);
  return c.json(await campaignsRepo(c.get("db")).updateDraft(c.req.param("id"), patch));
});

campaignRoutes.delete("/:id", async (c) => {
  await campaignsRepo(c.get("db")).deleteDraft(c.req.param("id"));
  return c.body(null, 204);
});

campaignRoutes.post("/:id/duplicate", async (c) =>
  c.json(await campaignsRepo(c.get("db")).duplicate(c.req.param("id"), c.get("actor").email), 201),
);

campaignRoutes.post("/:id/archive", async (c) => c.json(await campaignsRepo(c.get("db")).setArchived(c.req.param("id"), true)));
campaignRoutes.post("/:id/unarchive", async (c) => c.json(await campaignsRepo(c.get("db")).setArchived(c.req.param("id"), false)));

for (const action of ["pause", "resume", "cancel"] as const satisfies readonly CampaignAction[]) {
  campaignRoutes.post(`/:id/${action}`, async (c) =>
    c.json(await campaignsRepo(c.get("db")).applyAction(c.req.param("id"), action)),
  );
}

campaignRoutes.get("/:id/recipients", async (c) => {
  const query = parseQuery(c, recipientListQuery);
  return c.json(await campaignsRepo(c.get("db")).listRecipients(c.req.param("id"), query));
});
