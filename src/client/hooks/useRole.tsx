import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Role } from "@shared/types";

interface RoleCtx {
  role: Role;
  setRole: (r: Role) => void;
  /** Viewer is read-only. */
  canEdit: boolean;
  /** Only administrators manage settings, users and sender connection. */
  isAdmin: boolean;
}

const Ctx = createContext<RoleCtx | null>(null);

/** MOCK ONLY: lets you preview the UI as each role. Real roles come from Cloudflare Access + D1. */
export function RoleProvider({ children, initial = "Administrator" }: { children: ReactNode; initial?: Role }) {
  const [role, setRole] = useState<Role>(initial);
  const value = useMemo<RoleCtx>(
    () => ({ role, setRole, canEdit: role !== "Viewer", isAdmin: role === "Administrator" }),
    [role],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRole(): RoleCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRole must be used inside RoleProvider");
  return v;
}
