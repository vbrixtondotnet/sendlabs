import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createDb, type Database } from "./database/client";
import { ApiError } from "./lib/errors";
import { errorResponse, formatIssues } from "./lib/http";
import { requireActor, type Actor } from "./middleware/auth";
import { requestContext } from "./middleware/request-context";
import { campaignRoutes } from "./routes/campaigns";
import { contactRoutes } from "./routes/contacts";
import { healthRoutes } from "./routes/health";
import { importRoutes } from "./routes/imports";
import { MAX_FILE_BYTES } from "../shared/csv";
import { ZodError } from "zod";

export type AppEnv = {
  Bindings: Env;
  Variables: { correlationId: string; actor: Actor; db: Database };
};

const MAX_JSON_BYTES = 1024 * 1024;
/** The CSV upload is the one large request: the file limit plus room for the multipart framing. */
const MAX_UPLOAD_BYTES = MAX_FILE_BYTES + 256 * 1024;

/** Built by a factory so tests can mount it with their own bindings. */
export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", requestContext);
  const tooLarge = (c: Parameters<typeof errorResponse>[0]) => errorResponse(c, 413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  const jsonLimit = bodyLimit({ maxSize: MAX_JSON_BYTES, onError: tooLarge });
  const uploadLimit = bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: tooLarge });
  app.use("/api/*", (c, next) => (c.req.method === "POST" && c.req.path === "/api/imports" ? uploadLimit(c, next) : jsonLimit(c, next)));
  app.use("/api/*", async (c, next) => {
    c.set("db", createDb(c.env.DB));
    await next();
  });

  // Public: health only. Every other /api route requires an actor.
  app.route("/api/health", healthRoutes);

  const api = new Hono<AppEnv>();
  api.use("*", requireActor);
  api.route("/contacts", contactRoutes);
  api.route("/campaigns", campaignRoutes);
  api.route("/imports", importRoutes);
  app.route("/api", api);

  app.notFound((c) => errorResponse(c, 404, "NOT_FOUND", "Route not found"));

  app.onError((err, c) => {
    if (err instanceof ApiError) return errorResponse(c, err.status, err.code, err.message, err.details);
    if (err instanceof ZodError) return errorResponse(c, 400, "VALIDATION_ERROR", "Validation failed", formatIssues(err));
    // Anything else is a bug or an outage. Log operational metadata only and tell the client nothing specific.
    console.error(
      JSON.stringify({
        level: "error",
        correlationId: c.get("correlationId"),
        method: c.req.method,
        path: c.req.path,
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
    return errorResponse(c, 500, "INTERNAL_ERROR", "Something went wrong");
  });

  return app;
}
