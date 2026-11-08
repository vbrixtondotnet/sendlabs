import { eq } from "drizzle-orm";
import type { InvitationDto, InvitationPreviewDto } from "../../shared/api";
import { normalizeEmail } from "../../shared/email";
import { passwordProblem } from "../../shared/password-rules";
import type { InvitationCreate } from "../../shared/schemas";
import type { Role } from "../../shared/types";
import type { Database } from "../database/client";
import { invitationsRepo, previewByTokenHash } from "../database/repositories/invitations";
import { senderRepo } from "../database/repositories/sender";
import { users } from "../database/schema";
import { ApiError, badRequest, constraintMessage } from "../lib/errors";
import { decryptSecret, randomToken, sha256Base64Url } from "../lib/crypto";
import { newId, nowMs } from "../lib/id";
import { hashPassword } from "../lib/password";
import { buildMime, escapeHtml, toBase64Url } from "../lib/mime";
import { SESSION_TTL_MS } from "../lib/session";
import type { Actor } from "../middleware/auth";
import { GmailSendError, GoogleError, type GoogleConfig, type GoogleOAuth } from "./google-oauth";

/** The name recipients see on an invitation email, instead of the tenant's mailbox address. */
export const INVITATION_SENDER_NAME = "Sendrix";
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** The same address cannot be invited again for this long, so the button cannot be used to mail-bomb someone. */
export const RESEND_COOLDOWN_MS = 60 * 1000;
/** Invitations are sent through the tenant's own Gmail account, so one tenant cannot queue up unlimited mail. */
export const MAX_OPEN_INVITATIONS = 50;

export interface InviteDeps {
  db: Database;
  google: GoogleOAuth;
  cfg: GoogleConfig | null;
}

const INVALID = () => new ApiError(404, "INVITATION_INVALID", "This invitation link is invalid, has expired, or has already been used");

/** Tokens are exactly what randomToken makes. Anything else cannot be one of ours, so it is not even looked up. */
const looksLikeToken = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t);

export const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------------------------------ */
/*  Sending                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** The invitation email: a plain-text message with the full link, plus an HTML version with an Accept button. */
export function invitationEmail(input: { tenantName: string; firstName: string; link: string }) {
  const tenant = cleanName(input.tenantName);
  const first = cleanName(input.firstName);
  const expires = `${INVITATION_TTL_MS / (24 * 60 * 60 * 1000)} days`;
  const text = [
    `Hi ${first},`,
    "",
    `${tenant} has invited you to Sendrix.`,
    "",
    "Accept the invitation:",
    input.link,
    "",
    `This invitation expires in ${expires}. If you were not expecting it, you can ignore this email.`,
    "",
  ].join("\n");
  const html = [
    `<p>Hi ${escapeHtml(first)},</p>`,
    `<p><strong>${escapeHtml(tenant)}</strong> has invited you to Sendrix.</p>`,
    `<p><a href="${escapeHtml(input.link)}" style="display:inline-block;padding:10px 18px;background:#03809d;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600">Accept invitation</a></p>`,
    `<p style="color:#666666;font-size:13px">Or paste this link into your browser:<br>${escapeHtml(input.link)}</p>`,
    `<p style="color:#666666;font-size:13px">This invitation expires in ${expires}. If you were not expecting it, you can ignore this email.</p>`,
  ].join("\n");
  return { subject: `${tenant} has invited you to Sendrix`, text, html };
}

/**
 * Sends the invitation through the TENANT'S connected Gmail account. Any failure becomes an ApiError that says what
 * the Administrator can do about it; a token Google rejects also marks the connection as needing to be redone.
 */
async function deliver(deps: InviteDeps, who: { tenantId: string; tenantName: string }, to: { email: string; firstName: string }, token: string): Promise<void> {
  const { db, google, cfg } = deps;
  if (!cfg) throw new ApiError(503, "GMAIL_NOT_CONFIGURED", "Gmail connection is not set up on this server yet");
  const senders = senderRepo(db, who.tenantId);
  const sender = await senders.get();
  if (!sender) throw new ApiError(409, "SENDER_REQUIRED", "Connect a Gmail account in Settings before inviting people");

  const reconnect = async () => {
    await senders.markNeedsReconnect();
    return new ApiError(409, "SENDER_RECONNECT", "Google no longer accepts your Gmail connection. Reconnect it in Settings, then try again");
  };

  let refreshToken: string;
  try {
    refreshToken = await decryptSecret(sender.refreshTokenEncrypted, cfg.encryptionKey, `sender-refresh-token:${who.tenantId}`);
  } catch {
    throw await reconnect();
  }

  try {
    const accessToken = await google.refreshAccessToken(cfg, refreshToken);
    const email = invitationEmail({ tenantName: who.tenantName, firstName: to.firstName, link: `${cfg.appBaseUrl}/invite/${token}` });
    await google.sendMessage(accessToken, toBase64Url(buildMime({ from: sender.email, fromName: INVITATION_SENDER_NAME, to: to.email, subject: email.subject, text: email.text, html: email.html })));
  } catch (e) {
    if (e instanceof GoogleError && e.googleCode === "invalid_grant") throw await reconnect();
    if (e instanceof GmailSendError && e.kind === "auth") throw await reconnect();
    if (e instanceof GmailSendError && e.kind === "rate_limit") {
      throw new ApiError(429, "GMAIL_RATE_LIMITED", "Gmail is limiting sending from this account right now. Try again later");
    }
    console.error(JSON.stringify({ level: "error", event: "invitation_email_failed", tenantId: who.tenantId, kind: e instanceof GmailSendError ? e.kind : "other" }));
    throw new ApiError(502, "INVITE_EMAIL_FAILED", "The invitation email could not be sent. Please try again");
  }
}

/* ------------------------------------------------------------------------------------------ */
/*  Inviting                                                                                   */
/* ------------------------------------------------------------------------------------------ */

type Inviter = Pick<Actor, "tenantId" | "tenantName" | "userId">;

/**
 * Creates the invitation and emails it. If the email cannot be sent the invitation is withdrawn again, so the list
 * never shows an invitation nobody received.
 */
export async function createInvitation(deps: InviteDeps, inviter: Inviter, input: InvitationCreate): Promise<InvitationDto> {
  const { db } = deps;
  const normalizedEmail = normalizeEmail(input.email);
  const repo = invitationsRepo(db, inviter.tenantId);

  // Checked before anything is written, cheapest first.
  if (!deps.cfg) throw new ApiError(503, "GMAIL_NOT_CONFIGURED", "Gmail connection is not set up on this server yet");
  const sender = await senderRepo(db, inviter.tenantId).get();
  if (!sender) throw new ApiError(409, "SENDER_REQUIRED", "Connect a Gmail account in Settings before inviting people");
  if (sender.status !== "Connected") throw new ApiError(409, "SENDER_RECONNECT", "Reconnect your Gmail account in Settings before inviting people");

  const [existing] = await db.select({ tenantId: users.tenantId, isDeleted: users.isDeleted }).from(users).where(eq(users.normalizedEmail, normalizedEmail)).limit(1);
  // Someone removed from THIS tenant can be invited again: accepting reactivates their account.
  if (existing?.tenantId === inviter.tenantId && !existing.isDeleted) throw new ApiError(409, "ALREADY_MEMBER", "That person is already a user of your account");
  // An address that belongs to ANOTHER tenant must not be confirmed as a Sendrix user: one generic answer.
  if (existing && existing.tenantId !== inviter.tenantId) throw new ApiError(409, "CANNOT_INVITE", "That email address cannot be invited");

  const last = await repo.lastSentTo(normalizedEmail);
  if (last !== null && nowMs() - last < RESEND_COOLDOWN_MS) {
    throw new ApiError(429, "INVITATION_TOO_SOON", "An invitation was just sent to that address. Wait a minute before sending another");
  }
  if ((await repo.openCount()) >= MAX_OPEN_INVITATIONS) {
    throw new ApiError(429, "TOO_MANY_INVITATIONS", `You have ${MAX_OPEN_INVITATIONS} invitations waiting. Revoke some, or wait for them to be accepted`);
  }

  const token = randomToken();
  const id = await repo.create({
    email: input.email,
    normalizedEmail,
    firstName: cleanName(input.firstName),
    lastName: cleanName(input.lastName),
    accessId: input.accessId,
    invitedBy: inviter.userId,
    tokenHash: await sha256Base64Url(token),
    expiresAt: nowMs() + INVITATION_TTL_MS,
  });

  try {
    await deliver(deps, inviter, { email: input.email, firstName: cleanName(input.firstName) }, token);
  } catch (e) {
    await repo.revoke(id).catch(() => undefined); // no phantom invitation for an email that never went out
    throw e;
  }
  console.log(JSON.stringify({ level: "info", event: "invitation_sent", tenantId: inviter.tenantId, invitationId: id }));
  const dto = await repo.dto(id);
  if (!dto) throw new Error("Invitation vanished after creation");
  return dto;
}

/** Sends a fresh link for an open invitation. The old link stops working. */
export async function resendInvitation(deps: InviteDeps, inviter: Inviter, invitationId: string): Promise<InvitationDto> {
  const old = await invitationsRepo(deps.db, inviter.tenantId).get(invitationId);
  if (!old || old.status !== "Pending") throw new ApiError(404, "NOT_FOUND", "Invitation not found");
  return createInvitation(deps, inviter, { email: old.email, firstName: old.firstName, lastName: old.lastName, accessId: old.accessId as InvitationCreate["accessId"] });
}

export async function revokeInvitation(db: Database, tenantId: string, invitationId: string): Promise<void> {
  if (!(await invitationsRepo(db, tenantId).revoke(invitationId))) throw new ApiError(404, "NOT_FOUND", "Invitation not found");
}

/* ------------------------------------------------------------------------------------------ */
/*  Accepting (public: the person has no account yet)                                          */
/* ------------------------------------------------------------------------------------------ */

export async function previewInvitation(db: Database, token: string): Promise<InvitationPreviewDto> {
  if (!looksLikeToken(token)) throw INVALID();
  const row = await previewByTokenHash(db, await sha256Base64Url(token));
  if (!row) throw INVALID();
  return { tenantName: row.tenantName, email: row.email, firstName: row.firstName, lastName: row.lastName, access: row.access as Role, expiresAt: new Date(row.expiresAt).toISOString() };
}

/**
 * Turns an invitation into a user, and signs them in. One atomic batch, so either all of it happens or none:
 *   1. create the user (only if the invitation is still open, unexpired and for an active tenant)
 *   2. mark the invitation Accepted, naming that user
 *   3. start their session
 * Two people clicking at once cannot both succeed (the second finds the invitation used), and an address that already
 * has an account fails the whole batch, leaving the invitation untouched and usable.
 * The password is checked first, so a typo never uses the link up.
 */
export async function acceptInvitation(db: Database, token: string, password: string): Promise<{ sessionToken: string; expiresAt: number }> {
  if (!looksLikeToken(token)) throw INVALID();
  const problem = passwordProblem(password);
  if (problem) throw badRequest("Validation failed", [{ path: "password", message: problem }], "VALIDATION_ERROR");

  const tokenHash = await sha256Base64Url(token);
  const passwordHash = await hashPassword(password);
  const sessionToken = randomToken();
  const now = nowMs();
  const expiresAt = now + SESSION_TTL_MS;
  const d1 = db.$client;

  // Someone previously removed from this tenant keeps their row (soft delete). Accepting brings that same account
  // back, instead of creating a second one for the same address.
  const returning = await d1
    .prepare(
      `SELECT u.id AS id FROM invitations i JOIN users u ON u.tenant_id = i.tenant_id AND u.normalized_email = i.normalized_email
       WHERE i.token_hash = ?1 AND u.is_deleted = 1`,
    )
    .bind(tokenHash)
    .first<{ id: string }>();
  const userId = returning?.id ?? newId();

  // The password hash carries a random salt, so it identifies THIS call. Later statements require it, which stops a
  // concurrent loser from getting a session for the account the winner just activated.
  const validInvitation = `i.token_hash = ?4 AND i.status = 'Pending' AND i.expires_at > ?3 AND t.status = 'Active'`;

  let results;
  try {
    results = await d1.batch([
      returning
        ? d1
            .prepare(
              `UPDATE users SET is_deleted = 0, deleted_at = NULL, status = 'Active', password_hash = ?2, must_change_password = 0,
                      first_name = (SELECT i.first_name FROM invitations i WHERE i.token_hash = ?4),
                      last_name = (SELECT i.last_name FROM invitations i WHERE i.token_hash = ?4),
                      display_name = (SELECT trim(i.first_name || ' ' || i.last_name) FROM invitations i WHERE i.token_hash = ?4),
                      access_id = (SELECT i.access_id FROM invitations i WHERE i.token_hash = ?4),
                      last_login_at = ?3, updated_at = ?3
               WHERE id = ?1 AND is_deleted = 1
                 AND EXISTS (SELECT 1 FROM invitations i JOIN tenants t ON t.id = i.tenant_id WHERE ${validInvitation} AND i.tenant_id = users.tenant_id)`,
            )
            .bind(userId, passwordHash, now, tokenHash)
        : d1
            .prepare(
              `INSERT INTO users (id, tenant_id, email, normalized_email, first_name, last_name, display_name, password_hash,
                                  must_change_password, access_id, status, last_login_at, created_at, updated_at)
               SELECT ?1, i.tenant_id, i.email, i.normalized_email, i.first_name, i.last_name, trim(i.first_name || ' ' || i.last_name), ?2,
                      0, i.access_id, 'Active', ?3, ?3, ?3
               FROM invitations i JOIN tenants t ON t.id = i.tenant_id
               WHERE ${validInvitation}`,
            )
            .bind(userId, passwordHash, now, tokenHash),
      d1
        .prepare(
          `UPDATE invitations SET status = 'Accepted', accepted_at = ?1, accepted_user_id = ?2, updated_at = ?1
           WHERE token_hash = ?3 AND status = 'Pending'
             AND EXISTS (SELECT 1 FROM users WHERE id = ?2 AND is_deleted = 0 AND password_hash = ?4)
           RETURNING id`,
        )
        .bind(now, userId, tokenHash, passwordHash),
      d1
        .prepare(
          `INSERT INTO sessions (id, tenant_id, user_id, token_hash, expires_at, created_at)
           SELECT ?1, tenant_id, id, ?2, ?3, ?4 FROM users WHERE id = ?5 AND is_deleted = 0 AND password_hash = ?6`,
        )
        .bind(newId(), await sha256Base64Url(sessionToken), expiresAt, now, userId, passwordHash),
    ]);
  } catch (e) {
    const message = constraintMessage(e);
    if (message.includes("users.normalized_email") || message.includes("users_normalized_email_uq")) {
      throw new ApiError(409, "EMAIL_EXISTS", "An account with this email address already exists");
    }
    throw e;
  }

  // The UPDATE returns a row only if this call is the one that used the invitation up.
  if ((results[1]?.results?.length ?? 0) !== 1) throw INVALID();
  console.log(JSON.stringify({ level: "info", event: "invitation_accepted" }));
  return { sessionToken, expiresAt };
}
