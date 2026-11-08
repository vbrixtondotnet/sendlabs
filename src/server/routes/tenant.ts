import { Hono } from "hono";
import { tenantUpdateSchema } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { parseJson } from "../lib/http";
import { requireAccess } from "../middleware/auth";
import { updateTenant } from "../services/account";

/** The caller's own organization (company details). Administrators only. There is no id to pass: it is always the signed-in user's tenant. */
export const tenantRoutes = new Hono<AppEnv>();

tenantRoutes.use("*", requireAccess("Administrator"));

tenantRoutes.patch("/", async (c) => {
  const body = await parseJson(c, tenantUpdateSchema);
  return c.json(await updateTenant(c.get("db"), c.get("actor").tenantId, body));
});
