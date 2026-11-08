import type { SenderDto, SenderStatusDto } from "../../shared/api";
import { normalizeEmail } from "../../shared/email";
import type { SenderConnectError } from "../../shared/types";
import type { Database } from "../database/client";
import { oauthStatesRepo, senderRepo } from "../database/repositories/sender";
import { usersRepo } from "../database/repositories/users";
import type { SenderAccountRow } from "../database/schema/sender";
import { decryptSecret, encryptSecret, randomToken, sha256Base64Url } from "../lib/crypto";
import { GMAIL_SEND_SCOPE, GoogleError, type GoogleConfig, type GoogleOAuth } from "./google-oauth";

/** How long the Administrator has to finish on Google's screen. */
const STATE_TTL_MS = 10 * 60 * 1000;

/** Ciphertext is bound to these, so a stored secret only decrypts for the tenant (and attempt) it was made for. */
const tokenContext = (tenantId: string) => `sender-refresh-token:${tenantId}`;
const verifierContext = (tenantId: string, userId: string) => `oauth-verifier:${tenantId}:${userId}`;

/** What the granted scopes mean to a person. */
function permissionsOf(scopes: string): string[] {
  return scopes.split(/\s+/).includes(GMAIL_SEND_SCOPE) ? ["Send email"] : [];
}

/** Step 0: the Administrator clicks Connect. Returns Google's consent-screen address. */
export async function startGmailConnect(
  db: Database,
  google: GoogleOAuth,
  cfg: GoogleConfig,
  who: { tenantId: string; userId: string },
): Promise<{ url: string }> {
  const state = randomToken();
  const codeVerifier = randomToken(48);
  await oauthStatesRepo(db).start({
    tenantId: who.tenantId,
    userId: who.userId,
    // Only a hash of `state` is stored. Google gets the value, the database never does.
    stateHash: await sha256Base64Url(state),
    codeVerifierEncrypted: await encryptSecret(codeVerifier, cfg.encryptionKey, verifierContext(who.tenantId, who.userId)),
    ttlMs: STATE_TTL_MS,
  });
  return { url: google.authorizationUrl(cfg, { state, codeChallenge: await sha256Base64Url(codeVerifier) }) };
}

export type ConnectResult = { ok: true } | { ok: false; reason: SenderConnectError };

/**
 * Steps 1 to 5 of the workflow, when Google sends the browser back:
 *  1. receive the authorization code (after proving the callback belongs to an attempt we started)
 *  2. exchange it for tokens
 *  3. store the refresh token, encrypted
 *  4. read the authenticated email address
 *  5. the account is now the tenant's campaign sender
 * It returns a reason code rather than throwing, because every failure ends the same way: back to the app with an
 * explanation. Tokens, codes and addresses are never logged.
 */
export async function completeGmailConnect(
  db: Database,
  google: GoogleOAuth,
  cfg: GoogleConfig | null,
  input: { code: string | null; state: string | null; googleError: string | null },
): Promise<ConnectResult> {
  if (!cfg) return { ok: false, reason: "not_configured" };
  if (!input.state) return { ok: false, reason: "invalid_state" };

  // Use the attempt up, whatever happens next: it can never be replayed.
  const attempt = await oauthStatesRepo(db).claim(await sha256Base64Url(input.state));
  if (!attempt) return { ok: false, reason: "invalid_state" };
  if (input.googleError) return { ok: false, reason: "denied" };
  if (!input.code) return { ok: false, reason: "invalid_state" };
  if (!(await oauthStatesRepo(db).isActive(attempt.tenantId, attempt.userId))) return { ok: false, reason: "inactive" };

  let verifier: string;
  try {
    verifier = await decryptSecret(attempt.codeVerifierEncrypted, cfg.encryptionKey, verifierContext(attempt.tenantId, attempt.userId));
  } catch {
    return { ok: false, reason: "invalid_state" };
  }

  // 2. code -> tokens
  let tokens;
  try {
    tokens = await google.exchangeCode(cfg, input.code, verifier);
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "gmail_exchange_failed", tenantId: attempt.tenantId, googleCode: e instanceof GoogleError ? e.googleCode : null }));
    return { ok: false, reason: "exchange_failed" };
  }

  // Google lets people untick boxes. No permission to send means the connection is useless, so refuse it and
  // take back what Google just granted rather than leave an orphaned authorization behind.
  if (!tokens.scopes.includes(GMAIL_SEND_SCOPE)) {
    await google.revoke(tokens.refreshToken ?? tokens.accessToken);
    return { ok: false, reason: "missing_permission" };
  }
  if (!tokens.refreshToken) {
    await google.revoke(tokens.accessToken);
    return { ok: false, reason: "no_refresh_token" };
  }

  // 4. who is this?
  let email: string;
  try {
    email = await google.userEmail(tokens.accessToken);
  } catch {
    await google.revoke(tokens.refreshToken);
    return { ok: false, reason: "email_unavailable" };
  }

  // 3 + 5. store it, replacing any earlier connection of this tenant
  const repo = senderRepo(db, attempt.tenantId);
  const previous = await repo.get();
  await repo.upsert({
    email,
    normalizedEmail: normalizeEmail(email),
    refreshTokenEncrypted: await encryptSecret(tokens.refreshToken, cfg.encryptionKey, tokenContext(attempt.tenantId)),
    scopes: tokens.scopes.join(" "),
    connectedBy: attempt.userId,
  });
  console.log(JSON.stringify({ level: "info", event: "gmail_connected", tenantId: attempt.tenantId, replaced: previous !== null }));

  // The token it replaced is now dead weight at Google: cancel it. Best effort.
  if (previous) {
    try {
      await google.revoke(await decryptSecret(previous.refreshTokenEncrypted, cfg.encryptionKey, tokenContext(attempt.tenantId)));
    } catch {
      /* an undecryptable old token cannot be revoked, and that must not undo the new connection */
    }
  }
  return { ok: true };
}

/** Disconnects the tenant's account and tells Google to cancel its token. Returns false if nothing was connected. */
export async function disconnectSender(db: Database, google: GoogleOAuth, cfg: GoogleConfig | null, tenantId: string): Promise<boolean> {
  const removed = await senderRepo(db, tenantId).remove();
  if (!removed) return false;
  if (cfg) {
    try {
      await google.revoke(await decryptSecret(removed.refreshTokenEncrypted, cfg.encryptionKey, tokenContext(tenantId)));
    } catch {
      /* the account is disconnected here either way */
    }
  }
  return true;
}

/**
 * The tenant's refresh token, decrypted. Only the sending code will call this. It exists now so the binding of
 * a token to its tenant is real and tested before anything depends on it.
 */
export async function refreshTokenFor(db: Database, cfg: GoogleConfig, tenantId: string): Promise<string | null> {
  const row = await senderRepo(db, tenantId).get();
  return row ? decryptSecret(row.refreshTokenEncrypted, cfg.encryptionKey, tokenContext(tenantId)) : null;
}

async function toDto(db: Database, tenantId: string, row: SenderAccountRow): Promise<SenderDto> {
  const emails = await usersRepo(db, tenantId).emails([row.connectedBy]);
  return {
    id: row.id,
    provider: row.provider,
    email: row.email,
    status: row.status,
    permissions: permissionsOf(row.scopes),
    connectedBy: emails.get(row.connectedBy) ?? "",
    connectedAt: new Date(row.connectedAt).toISOString(),
  };
}

/** What the Sender tab shows. Never contains a token. */
export async function senderStatus(db: Database, tenantId: string, configured: boolean): Promise<SenderStatusDto> {
  const row = await senderRepo(db, tenantId).get();
  return { configured, sender: row ? await toDto(db, tenantId, row) : null };
}
