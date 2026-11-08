import type { Database } from "../database/client";
import { usersRepo } from "../database/repositories/users";
import { ApiError } from "../lib/errors";
import type { Actor } from "../middleware/auth";

/**
 * Removes a user from the caller's tenant (soft delete, see usersRepo.remove). An Administrator cannot remove
 * themselves, and the last active Administrator cannot be removed, so a tenant can never lock itself out.
 * A user of another tenant, or one already removed, is a plain 404.
 */
export async function removeUser(db: Database, actor: Pick<Actor, "tenantId" | "userId">, userId: string): Promise<void> {
  if (userId === actor.userId) throw new ApiError(409, "CANNOT_REMOVE_SELF", "You cannot remove your own account");
  const result = await usersRepo(db, actor.tenantId).remove(userId);
  if (result === "not_found") throw new ApiError(404, "NOT_FOUND", "User not found");
  if (result === "last_administrator") throw new ApiError(409, "LAST_ADMINISTRATOR", "At least one active Administrator must remain");
  console.log(JSON.stringify({ level: "info", event: "user_removed", tenantId: actor.tenantId, userId }));
}
