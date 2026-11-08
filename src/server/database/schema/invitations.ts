import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { INVITATION_STATUSES } from "../../../shared/types";
import { access } from "./access";
import { createdAt, idColumn, inList, normalizedEmailRule, updatedAt } from "./helpers";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * An Administrator's invitation for one person to join one tenant.
 *
 * The invitation link carries a secret token that exists only in the email. Here there is only its SHA-256
 * hash, so reading this table cannot reveal a working link. The token is single-use: accepting flips
 * `status` to Accepted in the same atomic step that creates the user.
 */
export const invitations = sqliteTable(
  "invitations",
  {
    id: idColumn(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    /** As typed by the Administrator (trimmed). */
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    /** The access level the person will get when they accept. */
    accessId: text("access_id")
      .notNull()
      .references(() => access.id, { onDelete: "restrict" }),

    /** SHA-256 (base64url) of the secret in the link. Never the secret itself. */
    tokenHash: text("token_hash").notNull(),
    status: text("status", { enum: INVITATION_STATUSES }).notNull().default("Pending"),
    expiresAt: integer("expires_at").notNull(),

    /** The Administrator who sent it. The composite key guarantees they belong to the same tenant. */
    invitedBy: text("invited_by").notNull(),

    acceptedAt: integer("accepted_at"),
    /** The user that accepting created. */
    acceptedUserId: text("accepted_user_id"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_uq").on(t.tokenHash),
    // At most ONE open invitation per address per tenant. Sending another replaces the first (see invitationsRepo.create).
    uniqueIndex("invitations_pending_email_uq").on(t.tenantId, t.normalizedEmail).where(sql`${t.status} = 'Pending'`),
    index("invitations_tenant_status_idx").on(t.tenantId, t.status, t.createdAt),
    foreignKey({ columns: [t.tenantId, t.invitedBy], foreignColumns: [users.tenantId, users.id], name: "invitations_inviter_fk" }),
    foreignKey({ columns: [t.tenantId, t.acceptedUserId], foreignColumns: [users.tenantId, users.id], name: "invitations_accepted_user_fk" }),
    check("invitations_status_chk", inList("status", INVITATION_STATUSES)),
    check("invitations_email_chk", normalizedEmailRule("normalized_email")),
    check("invitations_names_chk", sql.raw(`length(trim("first_name")) > 0 AND length(trim("last_name")) > 0`)),
    check("invitations_token_chk", sql.raw(`"token_hash" <> ''`)),
    // An accepted invitation records who and when; nothing else does.
    check("invitations_accepted_chk", sql.raw(`("status" = 'Accepted') = ("accepted_at" IS NOT NULL AND "accepted_user_id" IS NOT NULL)`)),
  ],
);

export type InvitationRow = typeof invitations.$inferSelect;
