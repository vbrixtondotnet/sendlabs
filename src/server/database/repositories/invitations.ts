import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import type { InvitationDto } from "../../../shared/api";
import type { AccessId, Role } from "../../../shared/types";
import { nowMs } from "../../lib/id";
import { iso } from "../../lib/http";
import type { Database } from "../client";
import { access, invitations, tenants } from "../schema";
import { usersRepo } from "./users";

export interface NewInvitation {
  email: string;
  normalizedEmail: string;
  firstName: string;
  lastName: string;
  position: string;
  accessId: AccessId;
  invitedBy: string;
  tokenHash: string;
  expiresAt: number;
}

/** Scoped to `tenantId`: another tenant's invitations do not exist as far as this repository is concerned. */
export function invitationsRepo(db: Database, tenantId: string) {
  const mine = eq(invitations.tenantId, tenantId);
  const users = usersRepo(db, tenantId);

  const columns = {
    id: invitations.id,
    email: invitations.email,
    firstName: invitations.firstName,
    lastName: invitations.lastName,
    position: invitations.position,
    accessId: invitations.accessId,
    accessName: access.name,
    invitedBy: invitations.invitedBy,
    createdAt: invitations.createdAt,
    expiresAt: invitations.expiresAt,
  };

  type Row = { id: string; email: string; firstName: string; lastName: string; position: string; accessId: string; accessName: string; invitedBy: string; createdAt: number; expiresAt: number };

  const toDto = (r: Row, emails: Map<string, string>): InvitationDto => ({
    id: r.id,
    email: r.email,
    firstName: r.firstName,
    lastName: r.lastName,
    position: r.position,
    access: r.accessName as Role,
    accessId: r.accessId as AccessId,
    // The row stays "Pending" in the database until something replaces it; to the person it is Expired once its date passes.
    status: r.expiresAt <= nowMs() ? "Expired" : "Pending",
    invitedBy: emails.get(r.invitedBy) ?? "",
    createdAt: iso(r.createdAt),
    expiresAt: iso(r.expiresAt),
  });

  return {
    /** Open invitations (not accepted, not revoked), newest first. Includes ones that have expired, so they can be resent. */
    async list(): Promise<InvitationDto[]> {
      const rows = await db
        .select(columns)
        .from(invitations)
        .innerJoin(access, eq(invitations.accessId, access.id))
        .where(and(mine, eq(invitations.status, "Pending")))
        .orderBy(desc(invitations.createdAt), desc(invitations.id))
        .limit(200);
      const emails = await users.emails(rows.map((r) => r.invitedBy));
      return rows.map((r) => toDto(r, emails));
    },

    async get(id: string) {
      const [row] = await db.select().from(invitations).where(and(mine, eq(invitations.id, id))).limit(1);
      return row ?? null;
    },

    async dto(id: string): Promise<InvitationDto | null> {
      const [row] = await db
        .select(columns)
        .from(invitations)
        .innerJoin(access, eq(invitations.accessId, access.id))
        .where(and(mine, eq(invitations.id, id)))
        .limit(1);
      if (!row) return null;
      return toDto(row, await users.emails([row.invitedBy]));
    },

    /** When the newest invitation to this address was sent (any status), so a rapid re-send can be refused. */
    async lastSentTo(normalizedEmail: string): Promise<number | null> {
      const [row] = await db
        .select({ at: invitations.createdAt })
        .from(invitations)
        .where(and(mine, eq(invitations.normalizedEmail, normalizedEmail)))
        .orderBy(desc(invitations.createdAt))
        .limit(1);
      return row?.at ?? null;
    },

    /** How many invitations are waiting for an answer. Caps what one tenant can send through its Gmail account. */
    async openCount(): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(invitations)
        .where(and(mine, eq(invitations.status, "Pending"), gt(invitations.expiresAt, nowMs())));
      return row?.n ?? 0;
    },

    /**
     * Stores a new invitation and retires any earlier open one to the same address, in ONE atomic batch, so there is
     * never a moment with two live links (and the database allows only one open invitation per address anyway).
     * The earlier one becomes Expired if its date had passed, otherwise Revoked: its link stops working.
     */
    async create(input: NewInvitation): Promise<string> {
      const now = nowMs();
      const [, inserted] = await db.batch([
        db
          .update(invitations)
          .set({ status: sql`CASE WHEN ${invitations.expiresAt} <= ${now} THEN 'Expired' ELSE 'Revoked' END` })
          .where(and(mine, eq(invitations.normalizedEmail, input.normalizedEmail), eq(invitations.status, "Pending"))),
        db.insert(invitations).values({ tenantId, ...input }).returning({ id: invitations.id }),
      ]);
      const id = inserted[0]?.id;
      if (!id) throw new Error("Insert returned no row");
      return id;
    },

    /** Cancels an open invitation: its link stops working. Returns false if there is no such open invitation. */
    async revoke(id: string): Promise<boolean> {
      const rows = await db
        .update(invitations)
        .set({ status: "Revoked" })
        .where(and(mine, eq(invitations.id, id), eq(invitations.status, "Pending")))
        .returning({ id: invitations.id });
      return rows.length > 0;
    },
  };
}

/**
 * What the invitation page may learn from a link, for a link that is valid right now: unused, unexpired, and for
 * a tenant that is still active. Anything else answers null, and the caller must not say which of those it was.
 */
export async function previewByTokenHash(db: Database, tokenHash: string) {
  const [row] = await db
    .select({
      tenantName: tenants.name,
      email: invitations.email,
      firstName: invitations.firstName,
      lastName: invitations.lastName,
      access: access.name,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .innerJoin(tenants, eq(invitations.tenantId, tenants.id))
    .innerJoin(access, eq(invitations.accessId, access.id))
    .where(and(eq(invitations.tokenHash, tokenHash), eq(invitations.status, "Pending"), gt(invitations.expiresAt, nowMs()), eq(tenants.status, "Active")))
    .limit(1);
  return row ?? null;
}
