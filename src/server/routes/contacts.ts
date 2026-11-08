import { Hono } from "hono";
import type { AppEnv } from "../app";
import { contactsRepo } from "../database/repositories/contacts";
import { parseJson, parseQuery } from "../lib/http";
import { contactCreateSchema, contactListQuery, contactPatchSchema } from "../../shared/schemas";

/** Routes handle HTTP only: parse, call the repository, shape the response. */
export const contactRoutes = new Hono<AppEnv>();

contactRoutes.get("/", async (c) => {
  const query = parseQuery(c, contactListQuery);
  return c.json(await contactsRepo(c.get("db")).list(query));
});

contactRoutes.post("/", async (c) => {
  const body = await parseJson(c, contactCreateSchema);
  return c.json(await contactsRepo(c.get("db")).create(body), 201);
});

// Registered before "/:id" so "industries" is not read as an id.
contactRoutes.get("/industries", async (c) => c.json({ items: await contactsRepo(c.get("db")).industries() }));

contactRoutes.get("/:id",async (c) => c.json(await contactsRepo(c.get("db")).get(c.req.param("id"))));

contactRoutes.patch("/:id", async (c) => {
  const patch = await parseJson(c, contactPatchSchema);
  return c.json(await contactsRepo(c.get("db")).update(c.req.param("id"), patch));
});

contactRoutes.delete("/:id", async (c) => {
  await contactsRepo(c.get("db")).delete(c.req.param("id"));
  return c.body(null, 204);
});
