import { Hono } from "hono";
import type { AppEnv } from "../app";
import { ApiError } from "../lib/errors";
import { requireAccess } from "../middleware/auth";
import { googleConfig } from "../services/google-oauth";
import { completeGmailConnect, disconnectSender, senderStatus, startGmailConnect } from "../services/sender";
import type { SenderConnectError } from "../../shared/types";

/** Signed-in routes: the status, starting a connection, and disconnecting. */
export const senderRoutes = new Hono<AppEnv>();

/** Any signed-in user may see whether a sender is connected (the campaign editor needs it). No tokens are ever shown. */
senderRoutes.get("/", async (c) => {
  const { tenantId } = c.get("actor");
  return c.json(await senderStatus(c.get("db"), tenantId, googleConfig(c.env) !== null));
});

/**
 * Starts "Connect Gmail". Returns the Google consent-screen address as JSON and lets the browser go there, instead of
 * redirecting: a page cannot follow a cross-site redirect from a fetch, and starting a connection must not be a
 * plain link that anything could trigger.
 */
senderRoutes.post("/gmail/connect", requireAccess("Administrator"), async (c) => {
  const cfg = googleConfig(c.env);
  if (!cfg) throw new ApiError(503, "GMAIL_NOT_CONFIGURED", "Gmail connection is not set up on this server yet");
  const { tenantId, userId } = c.get("actor");
  return c.json(await startGmailConnect(c.get("db"), c.get("google"), cfg, { tenantId, userId }));
});

senderRoutes.delete("/", requireAccess("Administrator"), async (c) => {
  const { tenantId } = c.get("actor");
  const removed = await disconnectSender(c.get("db"), c.get("google"), googleConfig(c.env), tenantId);
  if (!removed) throw new ApiError(404, "NOT_FOUND", "No email account is connected");
  return c.body(null, 204);
});

/**
 * Where Google sends the browser back to. It is PUBLIC (Google, not our API client, makes this request), so it
 * trusts nothing in the request except a `state` value that matches an unused, unexpired attempt we started: that
 * attempt, not the request, says which tenant this is for.
 *
 * It always ends by redirecting to the app with a fixed result code, never free text, and only to the configured
 * app address (no open redirect). The address contains Google's one-time code, so it must not be cached or leaked
 * through a Referer header.
 */
export const senderPublicRoutes = new Hono<AppEnv>();

senderPublicRoutes.get("/gmail/callback", async (c) => {
  const cfg = googleConfig(c.env);
  const q = c.req.query();
  const result = await completeGmailConnect(c.get("db"), c.get("google"), cfg, {
    code: q["code"] ?? null,
    state: q["state"] ?? null,
    googleError: q["error"] ?? null,
  });

  const base = cfg?.appBaseUrl ?? "";
  const target = result.ok ? "?sender=connected" : `?sender=error&reason=${encodeURIComponent(result.reason satisfies SenderConnectError)}`;
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  return c.redirect(`${base}/settings${target}`, 302);
});
