import { Hono } from "hono";
import { jobListQuery } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { ApiError } from "../lib/errors";
import { parseQuery } from "../lib/http";
import { RemotiveError, RemotiveJobService } from "../services/remotive-jobs";

/**
 * Jobs, live from Remotive: nothing is stored. The browser asks us, we ask Remotive (RemotiveJobService: timeout, short in-memory
 * cache, one shared request for identical searches, an hourly cap), filter / sort / page the answer and send it back. Open to every
 * signed-in role: the jobs belong to no tenant. The request's own abort signal is passed on, so a search the page has already
 * replaced stops being waited for.
 */
export const jobRoutes = new Hono<AppEnv>();

const service = (c: { get: (k: "fetch") => typeof fetch }) => new RemotiveJobService({ fetch: c.get("fetch") });

/** A Remotive failure is a gateway problem, not a bug in ours: say so, in words the page can show. */
async function viaRemotive<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof RemotiveError) {
      const status = e.kind === "timeout" ? 504 : e.kind === "rate_limit" ? 429 : e.kind === "aborted" ? 408 : 502;
      throw new ApiError(status, e.kind === "rate_limit" ? "JOB_SOURCE_BUSY" : "JOB_SOURCE_UNAVAILABLE", e.message);
    }
    throw e;
  }
}

jobRoutes.get("/", async (c) => {
  const q = parseQuery(c, jobListQuery);
  return c.json(await viaRemotive(() => service(c).list(q, c.req.raw.signal)));
});
jobRoutes.get("/categories", async (c) => c.json({ items: await viaRemotive(() => service(c).categories(c.req.raw.signal)) }));
jobRoutes.get("/locations", async (c) => c.json({ items: await viaRemotive(() => service(c).locations(c.req.raw.signal)) }));
