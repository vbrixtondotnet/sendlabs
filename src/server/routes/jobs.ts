import { Hono } from "hono";
import { jobListQuery } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { ApiError } from "../lib/errors";
import { JobSourceError } from "../lib/live-fetch";
import { parseQuery } from "../lib/http";
import { JobSearchService, jobSources } from "../services/job-search";

/**
 * Jobs, live from Remotive and Arbeitnow, merged: nothing is stored. The browser asks us, we ask the sources (each with a timeout, a
 * short in-memory cache, one shared request for identical searches and an hourly cap: see their services), filter / sort / page the
 * merged list and send it back. Open to every signed-in role: the jobs belong to no tenant. The request's own abort signal is passed
 * on, so a search the page has already replaced stops being waited for.
 */
export const jobRoutes = new Hono<AppEnv>();

const service = (c: { get: (k: "fetch") => typeof fetch }) => new JobSearchService(jobSources(c.get("fetch")));

/** A source failure is a gateway problem, not a bug in ours: say so, in words the page can show. */
async function viaSources<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof JobSourceError) {
      const status = e.kind === "timeout" ? 504 : e.kind === "rate_limit" ? 429 : e.kind === "aborted" ? 408 : 502;
      throw new ApiError(status, e.kind === "rate_limit" ? "JOB_SOURCE_BUSY" : "JOB_SOURCE_UNAVAILABLE", e.message);
    }
    throw e;
  }
}

jobRoutes.get("/", async (c) => {
  const q = parseQuery(c, jobListQuery);
  return c.json(await viaSources(() => service(c).list(q, c.req.raw.signal)));
});
jobRoutes.get("/categories", async (c) => {
  const items = await viaSources(() => service(c).categories(c.req.raw.signal));
  return c.json({ items: items.map(({ value, label }) => ({ value, label })) });
});
jobRoutes.get("/locations", async (c) => c.json({ items: await viaSources(() => service(c).locations(c.req.raw.signal)) }));
