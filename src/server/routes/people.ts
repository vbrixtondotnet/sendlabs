import { Hono } from "hono";
import { peopleSearchQuery } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { globalContactsRepo } from "../database/repositories/global-contacts";
import { parseQuery } from "../lib/http";
import { addPersonAsContact } from "../services/people-credits";

/**
 * People search over the shared global_contacts directory (open to every signed-in role; the directory belongs to no tenant),
 * and "Add Contact", which copies one person into the caller's own contacts for a credit. The tenant is only used to show the
 * email address of people who are already its contacts.
 */
export const peopleRoutes = new Hono<AppEnv>();

// The choices for the Industry filter.
peopleRoutes.get("/industries", async (c) => c.json({ items: await globalContactsRepo(c.get("db"), c.get("actor").tenantId).industries() }));

peopleRoutes.get("/", async (c) => c.json(await globalContactsRepo(c.get("db"), c.get("actor").tenantId).search(parseQuery(c, peopleSearchQuery))));

// "Add Contact": makes the person one of the caller's contacts, reveals their email address and spends 1 credit (once per person).
peopleRoutes.post("/:id/add-contact", async (c) => {
  const a = c.get("actor");
  c.header("Cache-Control", "no-store");
  return c.json(await addPersonAsContact(c.get("db"), { userId: a.userId, tenantId: a.tenantId }, c.req.param("id")));
});
