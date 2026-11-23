import { Hono } from "hono";
import { peopleSearchQuery } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { globalContactsRepo } from "../database/repositories/global-contacts";
import { parseQuery } from "../lib/http";

/**
 * People search over the shared global_contacts directory. Read-only, and open to every signed-in role (it only looks things
 * up: nothing is saved, and the directory belongs to no tenant).
 */
export const peopleRoutes = new Hono<AppEnv>();

// The choices for the Industry filter.
peopleRoutes.get("/industries", async (c) => c.json({ items: await globalContactsRepo(c.get("db")).industries() }));

peopleRoutes.get("/", async (c) => c.json(await globalContactsRepo(c.get("db")).search(parseQuery(c, peopleSearchQuery))));
