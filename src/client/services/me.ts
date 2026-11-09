import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeDto } from "@shared/api";
import { api } from "./http";

/** The signed-in user and their tenant. Fetched once and kept: it only changes on sign-in. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeDto>("GET", "/api/me"),
    staleTime: 5 * 60_000,
  });
}

/** `Sabertooth Software Labs` -> `SS`; falls back to the email's first letters. Two characters at most. */
export function initialsOf(name: string, email: string): string {
  const words = (name || email.split("@")[0] || "?").split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "") : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Edit your own first name, last name and position. The header and every page showing your name refresh from the result. */
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { firstName: string; lastName: string; position?: string }) => api<{ firstName: string; lastName: string; position: string; displayName: string }>("PATCH", "/api/me", input),
    onSuccess: (saved) =>
      qc.setQueryData<MeDto>(["me"], (me) => (me ? { ...me, user: { ...me.user, ...saved } } : me)),
  });
}

/** Change your own password. Other devices are signed out by the server; this one stays signed in. */
export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) => api<void>("POST", "/api/me/password", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }), // clears the "must change password" flag
  });
}

/** Edit the company details (name and/or postal address). Administrators only; the server answers 403 otherwise. The header name refreshes from the result. */
export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; postalAddress?: string; website?: string; requireUnsubscribeLink?: boolean; oneClickUnsubscribe?: boolean }) => api<MeDto["tenant"]>("PATCH", "/api/tenant", input),
    onSuccess: (saved) => qc.setQueryData<MeDto>(["me"], (me) => (me ? { ...me, tenant: { ...me.tenant, ...saved } } : me)),
  });
}
