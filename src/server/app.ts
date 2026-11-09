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
import { authRoutes } from "./routes/auth";
import { invitationPublicRoutes } from "./routes/invitations";
import { meRoutes } from "./routes/me";
import { tenantRoutes } from "./routes/tenant";
import { suppressionRoutes } from "./routes/suppressions";
import { unsubscribeRoutes } from "./routes/unsubscribe";
import { senderPublicRoutes, senderRoutes } from "./routes/sender";
import { GoogleOAuth } from "./services/google-oauth";
import { testRecipientRoutes } from "./routes/test-recipients";
import { userRoutes } from "./routes/users";
import { MAX_FILE_BYTES } from "../shared/csv";
import { ZodError } from "zod";

export type AppEnv = {
  Bindings: Env;
  Variables: { correlationId: string; actor: Actor; db: Database; google: GoogleOAuth };
};

const MAX_JSON_BYTES = 1024 * 1024;
/** The CSV upload is the one large request: the file limit plus room for the multipart framing. */
const MAX_UPLOAD_BYTES = MAX_FILE_BYTES + 256 * 1024;

/**
 * Built by a factory so tests can mount it with their own bindings, and with a stand-in for Google
 * (`google`), so the whole Gmail connection can be tested without talking to the real service.
 */
export function createApp(options: { google?: GoogleOAuth } = {}) {
  const app = new Hono<AppEnv>();
  const google = options.google ?? new GoogleOAuth();

  app.use("*", requestContext);
  const tooLarge = (c: Parameters<typeof errorResponse>[0]) => errorResponse(c, 413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  const jsonLimit = bodyLimit({ maxSize: MAX_JSON_BYTES, onError: tooLarge });
  const uploadLimit = bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: tooLarge });
  app.use("/api/*", (c, next) => (c.req.method === "POST" && c.req.path === "/api/imports" ? uploadLimit(c, next) : jsonLimit(c, next)));
  // A browser always names the page that made a write. If it names any site other than this app, refuse: that is a
  // cross-site request, however it got here. (Requests with no Origin come from scripts and tools, not from a
  // page on another site, and are allowed.)
  app.use("/api/*", async (c, next) => {
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
    const origin = c.req.header("origin");
    // The unsubscribe endpoint is the exception: mail providers POST to it from their own servers (one-click unsubscribe),
    // and the signed token in its address is what authorizes it, not where the request came from.
    const exempt = c.req.path.startsWith("/api/unsubscribe/");
    if (unsafe && origin && !exempt && c.env.APP_BASE_URL) {
      let expected: string | null = null;
      try {
        expected = new URL(c.env.APP_BASE_URL).origin;
      } catch {
        /* a bad setting must not lock everyone out; the Gmail config check reports it */
      }
      if (expected && origin !== expected) {
        return errorResponse(c, 403, "BAD_ORIGIN", `Requests must come from ${expected}. Open the app at that address.`);
      }
    }
    await next();
  });
  app.use("/api/*", async (c, next) => {
    c.set("db", createDb(c.env.DB));
    c.set("google", google);
    await next();
  });

  // Public: health, and the page Google sends the browser back to. Everything else requires an actor.
  // The callback trusts only a one-time `state` we issued, which also says which tenant it is for.
  app.route("/api/health", healthRoutes);
  app.route("/api/sender", senderPublicRoutes);
  app.route("/api/invitations", invitationPublicRoutes);
  app.route("/api/auth", authRoutes);
  app.route("/api/unsubscribe", unsubscribeRoutes);

  const api = new Hono<AppEnv>();
  api.use("*", requireActor);
  api.route("/me", meRoutes);
  api.route("/tenant", tenantRoutes);
  api.route("/users", userRoutes);
  api.route("/sender", senderRoutes);
  api.route("/test-recipients", testRecipientRoutes);
  api.route("/suppressions", suppressionRoutes);
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
