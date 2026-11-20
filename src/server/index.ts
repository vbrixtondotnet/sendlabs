import { createApp } from "./app";
import { runScheduled } from "./services/scheduled";

const app = createApp();

/**
 * Worker entry. `fetch` serves the API. `scheduled` is the Cron Trigger (every minute, see wrangler.jsonc): it runs one pass
 * of the campaign sender, which sends each launched campaign's share for the day inside its send window.
 */
export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;
