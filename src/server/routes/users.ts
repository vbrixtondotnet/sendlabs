import { Hono } from "hono";
import { userCreateSchema, userUpdateSchema } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { parseJson } from "../lib/http";
import { addAccount, changeAccount, listAccounts, removeAccount } from "../services/users";

/** User Accounts. SuperAdmin only (the app gates the whole path). */
export const userRoutes = new Hono<AppEnv>();

userRoutes.get("/", async (c) => c.json({ items: await listAccounts(c.get("db")) }));

userRoutes.post("/", async (c) => c.json(await addAccount(c.get("db"), await parseJson(c, userCreateSchema)), 201));

userRoutes.patch("/:id", async (c) => c.json(await changeAccount(c.get("db"), c.get("actor").userId, c.req.param("id"), await parseJson(c, userUpdateSchema))));

userRoutes.delete("/:id", async (c) => {
  await removeAccount(c.get("db"), c.get("actor").userId, c.req.param("id"));
  return c.body(null, 204);
});
