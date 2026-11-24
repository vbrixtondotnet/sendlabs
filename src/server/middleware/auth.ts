import { eq } from "drizzle-orm";
import { authEnabled, devShortcutAllowed } from "../lib/auth-enabled";
import type { MiddlewareHandler } from "hono";
import { normalizeEmail } from "../../shared/email";
import type { AppEnv } from "../app";
import { users } from "../database/schema";
import { sessionsRepo } from "../database/repositories/sessions";
import { sha256Base64Url } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { nowMs } from "../lib/id";
import { readSessionCookie, SESSION_RENEW_AFTER_MS, SESSION_TTL_MS, setSessionCookie } from "../lib/session";

/** Who is making the request. They are the account: every repository is scoped by `userId`, and nothing else is ever trusted from the request. */
export interface Actor {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  position: string;
  displayName: string;
  /** The account's company details: what its emails say they are from. */
  companyName: string;
  postalAddress: string;
  website: string;
  requireUnsubscribeLink: boolean;
  oneClickUnsubscribe: boolean;
  mustChangePassword: boolean;
  /** True when this request carries a real session, false for the local development placeholder. */
  viaSession: boolean;
  /** The session this request belongs to, or null for the placeholder. */
  sessionId: string | null;
}

/**
 * Decides who is making the request.
 *
 *  1. A valid session cookie wins. Sessions are created by the login page.
 *  2. Otherwise, locally only, and only if DEV_ACTOR_EMAIL is set in `.dev.vars`, the request runs as that user. This
 *     is an opt-in shortcut for trying the API without signing in; by default it is off, so there is no way in
 *     except signing in.
 *
 * It fails closed: outside the local environment every protected route answers 503, session or not, so deploying
 * this build cannot expose anyone's data until that is deliberately enabled with `AUTH_ENABLED="true"` for that
 * deployment (see lib/auth-enabled.ts). Even then only sessions work: the DEV_ACTOR_EMAIL shortcut is local-only. The account always comes from
 * the session (or the shortcut's own row), never from anything the client sends, so a request can only ever reach its own data.
 *
 * A session whose account is disabled is refused outright. It does NOT quietly fall back
 * to the shortcut user. A cookie that is merely unknown or expired is ignored.
 */
export const requireActor: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!authEnabled(c.env)) {
    throw new ApiError(503, "AUTH_NOT_CONFIGURED", "Authentication is not configured for this environment");
  }
  const db = c.get("db");

  let viaSession = false;
  let session: { id: string; expiresAt: number; token: string } | null = null;
  type Found = NonNullable<Awaited<ReturnType<ReturnType<typeof sessionsRepo>["find"]>>>;
  let row = null as Omit<Found, "sessionId" | "expiresAt"> | null;
  const cookie = readSessionCookie(c);
  if (cookie) {
    const found = await sessionsRepo(db).find(await sha256Base64Url(cookie));
    if (found) {
      row = found;
      viaSession = true;
      session = { id: found.sessionId, expiresAt: found.expiresAt, token: cookie };
    }
  }

  if (!row && c.env.DEV_ACTOR_EMAIL && devShortcutAllowed(c.env)) {
    const email = normalizeEmail(c.env.DEV_ACTOR_EMAIL);
    const [dev] = await db
      .select({
        userId: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        position: users.position,
        displayName: users.displayName,
        userStatus: users.status,
        mustChangePassword: users.mustChangePassword,
        companyName: users.companyName,
        postalAddress: users.postalAddress,
        website: users.website,
        requireUnsubscribeLink: users.requireUnsubscribeLink,
        oneClickUnsubscribe: users.oneClickUnsubscribe,
      })
      .from(users)
      .where(eq(users.normalizedEmail, email))
      .limit(1);
    row = dev ?? null;
  }

  if (!row) {
    throw new ApiError(401, "NO_ACTIVE_USER", "Not signed in");
  }
  if (row.userStatus !== "Active") throw new ApiError(403, "USER_DISABLED", "This account is disabled");

  // Stay-signed-in: using the app restarts the 30 days. Only after the checks above, so a disabled user's session is
  // never extended, and only when the last renewal is old enough to be worth a write.
  if (session && session.expiresAt - nowMs() < SESSION_TTL_MS - SESSION_RENEW_AFTER_MS) {
    const expiresAt = nowMs() + SESSION_TTL_MS;
    if (await sessionsRepo(db).renew(session.id, expiresAt)) setSessionCookie(c, session.token, expiresAt);
  }

  c.set("actor", {
    userId: row.userId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    position: row.position,
    displayName: row.displayName,
    companyName: row.companyName,
    postalAddress: row.postalAddress,
    website: row.website,
    requireUnsubscribeLink: row.requireUnsubscribeLink,
    oneClickUnsubscribe: row.oneClickUnsubscribe,
    mustChangePassword: row.mustChangePassword,
    viaSession,
    sessionId: session?.id ?? null,
  });
  await next();
};
