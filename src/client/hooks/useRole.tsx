import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Role } from "@shared/types";
import { useMe } from "@/services/me";

interface RoleCtx {
  /** The signed-in user's real access level. Until it is known, the least powerful one, so nothing is offered early. */
  role: Role;
  /** False until the signed-in user has been loaded. */
  ready: boolean;
  /** Viewer is read-only. */
  canEdit: boolean;
  /** Only administrators manage settings, users and sender connection. */
  isAdmin: boolean;
}

const Ctx = createContext<RoleCtx | null>(null);

const valueFor = (role: Role, ready: boolean): RoleCtx => ({ role, ready, canEdit: role !== "Viewer", isAdmin: role === "Administrator" });

/**
 * What the signed-in user may do, taken from their real access level (from /api/me). It is only a way of showing or
 * hiding controls; the API is what actually refuses. `fixed` is for tests, to render a page as a given role without a
 * server (and without asking it who you are).
 */
export function RoleProvider({ children, fixed }: { children: ReactNode; fixed?: Role }) {
  return fixed !== undefined ? <FixedRole role={fixed}>{children}</FixedRole> : <RealRole>{children}</RealRole>;
}

function FixedRole({ role, children }: { role: Role; children: ReactNode }) {
  const value = useMemo(() => valueFor(role, true), [role]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function RealRole({ children }: { children: ReactNode }) {
  const me = useMe();
  const role: Role = me.data?.user.access ?? "Viewer";
  const ready = me.data !== undefined;
  const value = useMemo(() => valueFor(role, ready), [role, ready]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRole(): RoleCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRole must be used inside RoleProvider");
  return v;
}
