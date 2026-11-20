import { and, count, desc, eq, gte } from "drizzle-orm";
import type { PersonalEmailDto } from "../../../shared/api";
import { iso } from "../../lib/http";
import type { Database } from "../client";
import { personalEmails, type PersonalEmailRow } from "../schema";
import { usersRepo } from "./users";

/** Scoped to `tenantId`: another organization's one-to-one emails do not exist as far as this repository is concerned. */
export function personalEmailsRepo(db: Database, tenantId: string) {
  const mine = eq(personalEmails.tenantId, tenantId);

  const toDtos = async (rows: PersonalEmailRow[]): Promise<PersonalEmailDto[]> => {
    const who = await usersRepo(db, tenantId).emails(rows.map((r) => r.sentBy));
    return rows.map((r) => ({ id: r.id, to: r.recipient, subject: r.subject, body: r.body, sentBy: who.get(r.sentBy) ?? "", createdAt: iso(r.createdAt) }));
  };

  return {
    /** The latest, newest first. */
    async recent(limit: number): Promise<PersonalEmailDto[]> {
      return toDtos(await db.select().from(personalEmails).where(mine).orderBy(desc(personalEmails.createdAt), desc(personalEmails.id)).limit(limit));
    },

    /** How many were sent since `sinceMs`. */
    async countSince(sinceMs: number): Promise<number> {
      const [row] = await db.select({ n: count() }).from(personalEmails).where(and(mine, gte(personalEmails.createdAt, sinceMs)));
      return row?.n ?? 0;
    },

    async record(input: { recipient: string; normalizedRecipient: string; subject: string; body: string; sentBy: string }): Promise<PersonalEmailDto> {
      const [row] = await db.insert(personalEmails).values({ tenantId, ...input }).returning();
      if (!row) throw new Error("Insert returned no row");
      const [dto] = await toDtos([row]);
      return dto!;
    },
  };
}
