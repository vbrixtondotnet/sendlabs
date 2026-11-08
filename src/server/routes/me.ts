import { Hono } from "hono";
import type { MeDto } from "../../shared/api";
import type { AppEnv } from "../app";

/** Who is signed in and which tenant they belong to. Drives what the UI shows in its header. */
export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", (c) => {
  const a = c.get("actor");
  const me: MeDto = {
    user: { id: a.userId, email: a.email, displayName: a.displayName, access: a.access, mustChangePassword: a.mustChangePassword },
    tenant: { id: a.tenantId, name: a.tenantName, slug: a.tenantSlug },
    session: a.viaSession,
  };
  return c.json(me);
});
