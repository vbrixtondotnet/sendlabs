import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { ApiError } from "../lib/errors";

export interface Actor {
  /** Verified identity. Becomes `users.id` once the users table exists. */
  email: string;
}

/**
 * PLACEHOLDER until Cloudflare Access + role checks are built (decision D-02).
 *
 * It fails closed: outside the local environment every protected route answers 503, so deploying
 * this build to staging or production cannot expose contacts or campaigns without authentication.
 * Locally, requests run as a fixed development identity.
 */
export const requireActor: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.ENVIRONMENT !== "local") {
    throw new ApiError(503, "AUTH_NOT_CONFIGURED", "Authentication is not configured for this environment");
  }
  c.set("actor", { email: "dev@local" });
  await next();
};
