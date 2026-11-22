import { Hono } from "hono";
import { peopleSearchQuery } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { parseQuery } from "../lib/http";
import { peopleProvider } from "../services/people-search";

/** People search. Read-only, and open to every signed-in role (it only looks things up: nothing is saved). */
export const peopleRoutes = new Hono<AppEnv>();

peopleRoutes.get("/", async (c) => c.json(await peopleProvider().search(parseQuery(c, peopleSearchQuery))));
