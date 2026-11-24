import { Hono } from "hono";
import { globalContactListQuery, globalContactSchema } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { globalContactsAdminRepo } from "../database/repositories/global-contacts-admin";
import { ApiError, notFound } from "../lib/errors";
import { parseJson, parseQuery } from "../lib/http";

/** Managing the shared people directory (Search People reads it). SuperAdmin only: the app gates the whole path. */
export const globalContactRoutes = new Hono<AppEnv>();

const taken = () => new ApiError(409, "EMAIL_EXISTS", "A person with that email address is already in the directory", [{ path: "email", message: "Already in the directory" }]);

globalContactRoutes.get("/", async (c) => c.json(await globalContactsAdminRepo(c.get("db")).list(parseQuery(c, globalContactListQuery))));

globalContactRoutes.post("/", async (c) => {
  const r = await globalContactsAdminRepo(c.get("db")).create(await parseJson(c, globalContactSchema));
  if (r === "email-taken") throw taken();
  return c.json(r, 201);
});

globalContactRoutes.put("/:id", async (c) => {
  const r = await globalContactsAdminRepo(c.get("db")).update(c.req.param("id"), await parseJson(c, globalContactSchema));
  if (r === "missing") throw notFound("Person");
  if (r === "email-taken") throw taken();
  return c.json(r);
});

globalContactRoutes.delete("/:id", async (c) => {
  if (!(await globalContactsAdminRepo(c.get("db")).remove(c.req.param("id")))) throw notFound("Person");
  return c.body(null, 204);
});
