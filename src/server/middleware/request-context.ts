import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";

/**
 * Gives every request a correlation ID (echoed in the X-Correlation-Id header and in error bodies)
 * and writes one structured log line. Logs carry operational metadata only: no query string
 * (searches can contain personal data), no bodies, no headers.
 */
export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const correlationId = crypto.randomUUID();
  c.set("correlationId", correlationId);
  c.header("X-Correlation-Id", correlationId);
  const started = Date.now();
  try {
    await next();
  } finally {
    console.log(
      JSON.stringify({
        level: "info",
        correlationId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Date.now() - started,
      }),
    );
  }
};
