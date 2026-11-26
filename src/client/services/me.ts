import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeDto } from "@shared/api";
import { api } from "./http";

/** The signed-in user and their company details. Fetched once and kept: it only changes on sign-in. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeDto>("GET", "/api/me"),
    staleTime: 5 * 60_000,
  });
}

/** `Brixton Ray Villanueva` -> `BV` (first and last word); falls back to the email's first letters. Two characters at most. */
export function initialsOf(name: string, email: string): string {
  const words = (name || email.split("@")[0] || "?").split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? (words[0]?.[0] ?? "") + (words[words.length - 1]?.[0] ?? "") : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Your profile picture: uploads an image (the server checks it really is one) and the header shows it at once. Only the type and size are
 * checked here, for early feedback.
 */
export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return api<{ avatarUrl: string }>("PUT", "/api/me/avatar", form);
    },
    onSuccess: ({ avatarUrl }) => qc.setQueryData<MeDto>(["me"], (me) => (me ? { ...me, user: { ...me.user, avatarUrl } } : me)),
  });
}

/** Removes your profile picture: the header goes back to your initials. */
export function useRemoveAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("DELETE", "/api/me/avatar"),
    onSuccess: () => qc.setQueryData<MeDto>(["me"], (me) => (me ? { ...me, user: { ...me.user, avatarUrl: null } } : me)),
  });
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

/** Edit the account's company details (name, postal address, website, unsubscribe settings). The header refreshes from the result. */
export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; postalAddress?: string; website?: string; requireUnsubscribeLink?: boolean; oneClickUnsubscribe?: boolean }) => api<MeDto["company"]>("PATCH", "/api/me/company", input),
    onSuccess: (saved) => qc.setQueryData<MeDto>(["me"], (me) => (me ? { ...me, company: { ...me.company, ...saved } } : me)),
  });
}
