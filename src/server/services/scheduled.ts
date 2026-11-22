import { closeDb, connectionStringFor, createDb, type Database } from "../database/client";
import { unsubscribeConfig } from "../lib/unsubscribe";
import { runCampaignTick, type TickDeps, type TickResult } from "./campaign-sender";
import { emailProviderFor } from "./email-providers";
import { GoogleOAuth, googleConfig } from "./google-oauth";

/** What the sender needs, built from the Worker's environment the same way a request builds it. */
export function tickDepsFor(env: Env, parts: { db?: Database; google?: GoogleOAuth; fetch?: typeof fetch } = {}): TickDeps {
  const db = parts.db ?? createDb(connectionStringFor(env));
  const cfg = googleConfig(env);
  const email = emailProviderFor(env, { db, google: parts.google ?? new GoogleOAuth(), googleConfig: cfg, ...(parts.fetch ? { fetch: parts.fetch } : {}) });
  return { db, email, unsubscribe: unsubscribeConfig(env, cfg) };
}

/** The Cron Trigger: runs one pass of the campaign sender. Never throws, so one bad run cannot disable the schedule. */
export async function runScheduled(env: Env): Promise<TickResult | null> {
  let deps: ReturnType<typeof tickDepsFor> | null = null;
  try {
    deps = tickDepsFor(env);
    const result = await runCampaignTick(deps);
    if (result.campaigns > 0) console.log(JSON.stringify({ level: "info", event: "tick", ...result }));
    return result;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "tick_failed", kind: e instanceof Error ? e.name : "unknown" }));
    return null;
  } finally {
    if (deps) await closeDb(deps.db).catch(() => undefined);
  }
}
