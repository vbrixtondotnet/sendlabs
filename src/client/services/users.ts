import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserAccountDto } from "@shared/api";
import type { Role } from "@shared/types";
import { api } from "./http";

const KEY = ["user-accounts"] as const;

/** User Accounts (SuperAdmin only): every account, with its role and status. */
export function useUserAccounts() {
  return useQuery({ queryKey: KEY, queryFn: () => api<{ items: UserAccountDto[] }>("GET", "/api/users") });
}

export function useAddUserAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; firstName?: string; lastName?: string; role: Role; password: string }) => api<UserAccountDto>("POST", "/api/users", input),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useChangeUserAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; firstName?: string; lastName?: string; role?: Role; status?: "Active" | "Disabled"; password?: string }) =>
      api<UserAccountDto>("PATCH", `/api/users/${encodeURIComponent(id)}`, input),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRemoveUserAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/users/${encodeURIComponent(id)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
