import { Hono } from "hono";
import { suppressionListQuery } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { suppressionsRepo } from "../database/repositories/suppressions";
import { parseQuery } from "../lib/http";

/** The suppression list: who has unsubscribed from this account's emails. A Settings page, and read-only. */
export const suppressionRoutes = new Hono<AppEnv>();

suppressionRoutes.get("/", async (c) => {
  const q = parseQuery(c, suppressionListQuery);
  return c.json(await suppressionsRepo(c.get("db"), c.get("actor").userId).list(q.page, q.pageSize));
});
