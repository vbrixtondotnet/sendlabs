import type { Role } from "@shared/types";
import { useMe } from "@/services/me";

/** The signed-in account's role, or null while it is still loading (or when nobody is signed in). */
export function useRole(): { role: Role | null; ready: boolean } {
  const me = useMe();
  return { role: me.data?.user.role ?? null, ready: !me.isPending };
}
