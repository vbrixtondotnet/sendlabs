import { Hono } from "hono";
import type { AppEnv } from "../app";
import { sessionsRepo } from "../database/repositories/sessions";
import { sha256Base64Url } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/http";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "../lib/session";
import { login } from "../services/auth";
import { loginSchema } from "../../shared/schemas";

/** Public on purpose: signing in and out must work without a session. */
export const authRoutes = new Hono<AppEnv>();

/**
 * Email and password in, session cookie out. Fails closed outside the local environment, like every other protected
 * route, until deployment is deliberately enabled.
 */
authRoutes.post("/login", async (c) => {
  if (c.env.ENVIRONMENT !== "local") throw new ApiError(503, "AUTH_NOT_CONFIGURED", "Authentication is not configured for this environment");
  const body = await parseJson(c, loginSchema);
  c.header("Cache-Control", "no-store");
  try {
    const { sessionToken, expiresAt, mustChangePassword } = await login(c.get("db"), { ip: c.req.header("cf-connecting-ip") ?? null }, body);
    setSessionCookie(c, sessionToken, expiresAt);
    return c.json({ redirectTo: "/", mustChangePassword });
  } catch (e) {
    if (e instanceof ApiError && e.code === "TOO_MANY_ATTEMPTS") c.header("Retry-After", String((e.details as { retryAfterSeconds: number }).retryAfterSeconds));
    throw e;
  }
});

authRoutes.post("/logout", async (c) => {
  const cookie = readSessionCookie(c);
  if (cookie) await sessionsRepo(c.get("db")).end(await sha256Base64Url(cookie));
  clearSessionCookie(c);
  return c.body(null, 204);
});
