import { Hono } from "hono";
import { suppressionListQuery } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { suppressionsRepo } from "../database/repositories/suppressions";
import { parseQuery } from "../lib/http";
import { requireAccess } from "../middleware/auth";

/** The suppression list: who has unsubscribed. Administrators only (it is a Settings page), and read-only. */
export const suppressionRoutes = new Hono<AppEnv>();

suppressionRoutes.use("*", requireAccess("Administrator"));

suppressionRoutes.get("/", async (c) => {
  const q = parseQuery(c, suppressionListQuery);
  return c.json(await suppressionsRepo(c.get("db"), c.get("actor").tenantId).list(q.page, q.pageSize));
});
