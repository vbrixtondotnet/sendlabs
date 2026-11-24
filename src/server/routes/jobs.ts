import { Hono } from "hono";
import { jobListQuery } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { jobsRepo } from "../database/repositories/jobs";
import { ApiError } from "../lib/errors";
import { parseQuery } from "../lib/http";
import { requireAccess } from "../middleware/auth";
import { RemotiveError, RemotiveJobService } from "../services/remotive-jobs";

/**
 * Jobs, from the shared `global_jobs` table (Remotive today). Reading is open to every signed-in role: the jobs belong to the
 * platform, not to a tenant. The browser never talks to Remotive; only `POST /sync`, for the SuperAdministrator, and the scheduled
 * run do, through RemotiveJobService.
 */
export const jobRoutes = new Hono<AppEnv>();

jobRoutes.get("/", async (c) => c.json(await jobsRepo(c.get("db")).search(parseQuery(c, jobListQuery))));
jobRoutes.get("/categories", async (c) => c.json({ items: await jobsRepo(c.get("db")).categories() }));
jobRoutes.get("/locations", async (c) => c.json({ items: await jobsRepo(c.get("db")).locations() }));
jobRoutes.get("/companies", async (c) => c.json({ items: await jobsRepo(c.get("db")).companies() }));

/** Pulls the latest jobs now. Remotive asks for about 4 fetches a day, so this is for the platform owner, not for every user. */
jobRoutes.post("/sync", requireAccess("SuperAdministrator"), async (c) => {
  try {
    return c.json(await new RemotiveJobService({ db: c.get("db"), fetch: c.get("fetch") }).sync());
  } catch (e) {
    if (e instanceof RemotiveError) {
      throw new ApiError(e.kind === "timeout" ? 504 : 502, "JOB_SOURCE_UNAVAILABLE", e.message);
    }
    throw e;
  }
});
