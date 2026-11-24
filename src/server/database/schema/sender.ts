import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { SENDER_PROVIDERS, SENDER_STATUSES } from "../../../shared/types";
import { createdAt, idColumn, inList, updatedAt } from "./helpers";
import { users } from "./users";

/**
 * The email account an account sends from, connected through Google's OAuth consent screen.
 *
 * One per account for now (the unique index on `user_id`). Drop that index to allow several later.
 * The long-lived refresh token is stored ENCRYPTED (AES-256-GCM) and is bound to the account, so a
 * ciphertext copied into another account's row cannot be decrypted. Short-lived access tokens are never
 * stored: they expire within the hour and are minted again from the refresh token when needed.
 */
export const senderAccounts = pgTable(
  "sender_accounts",
  {
    id: idColumn(),
    /** The account that owns this connection. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    provider: text("provider", { enum: SENDER_PROVIDERS }).notNull().default("gmail"),
    /** The address Google reported for the authorized account. Campaigns are sent from this address. */
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    status: text("status", { enum: SENDER_STATUSES }).notNull().default("Connected"),

    /** `v1.<iv>.<ciphertext>`. See lib/crypto.ts. Never log it, never return it from the API. */
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    /** Which encryption key sealed it, so keys can be rotated without losing connected accounts. */
    keyVersion: integer("key_version").notNull().default(1),
    /** Space-separated scopes Google granted. Checked for the permission to send before anything is stored. */
    scopes: text("scopes").notNull(),

    /**
     * The name recipients see on the From line ("Marketing Admin <sales@acme.com>"). Gmail on the web uses the mailbox's own
     * name, and mail that carries a different name has been filed under Spam, so it is set to match.
     * Empty means none was set: the account's own name is used instead.
     */
    senderName: text("sender_name").notNull().default(""),

    connectedAt: bigint("connected_at", { mode: "number" }).notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sender_accounts_user_uq").on(t.userId),
    // Lets campaigns reference "a sender of the SAME account" with a composite foreign key later.
    uniqueIndex("sender_accounts_user_id_uq").on(t.userId, t.id),
    check("sender_accounts_provider_chk", inList("provider", SENDER_PROVIDERS)),
    check("sender_accounts_status_chk", inList("status", SENDER_STATUSES)),
    check("sender_accounts_email_chk", sql.raw(`"normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email"))`)),
    check("sender_accounts_token_chk", sql.raw(`"refresh_token_encrypted" <> ''`)),
  ],
);

/**
 * One in-flight "Connect Gmail" attempt. Created when the account holder clicks Connect, consumed (once) when
 * Google sends the browser back. Holds the secret that proves the callback belongs to the attempt we started.
 * Only a hash of the `state` value is stored, and the PKCE verifier is encrypted, so a database read alone
 * cannot complete someone's connection.
 */
export const oauthStates = pgTable(
  "oauth_states",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** SHA-256 of the random `state` sent to Google. The value itself is never stored. */
    stateHash: text("state_hash").notNull(),
    /** PKCE code verifier, encrypted. Google must see its challenge first and this value second. */
    codeVerifierEncrypted: text("code_verifier_encrypted").notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    /** Set when the callback claims it. A used state is dead: a replayed callback is refused. */
    usedAt: bigint("used_at", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("oauth_states_hash_uq").on(t.stateHash),
    index("oauth_states_expires_idx").on(t.expiresAt),
  ],
);

export type SenderAccountRow = typeof senderAccounts.$inferSelect;
export type OauthStateRow = typeof oauthStates.$inferSelect;
