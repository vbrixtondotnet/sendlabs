import { Hono } from "hono";
import type { AppEnv } from "../app";

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get("/", async (c) => {
  let database: "ok" | "error" = "ok";
  try {
    await c.env.DB.prepare("SELECT 1").first();
  } catch {
    database = "error";
  }
  // No secrets, versions or binding details are exposed.
  return c.json({ status: database === "ok" ? "ok" : "degraded", database }, database === "ok" ? 200 : 503);
});
