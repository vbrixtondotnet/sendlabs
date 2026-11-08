import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InvitationDto, Page, UserDto } from "@shared/api";
import type { AccessId } from "@shared/types";
import { api, withQuery } from "./http";

/** The users of the signed-in user's tenant. Administrators only (the API answers 403 otherwise). */
export function useUsers(page = 1, pageSize = 25) {
  return useQuery({
    queryKey: ["users", page, pageSize],
    queryFn: () => api<Page<UserDto>>("GET", withQuery("/api/users", { page, pageSize })),
    placeholderData: keepPreviousData,
  });
}

/** Invitations that are waiting for an answer, or have expired and can be resent. */
export function useInvitations() {
  return useQuery({
    queryKey: ["invitations"],
    queryFn: () => api<{ items: InvitationDto[] }>("GET", "/api/users/invitations"),
  });
}

export interface InviteInput {
  email: string;
  firstName: string;
  lastName: string;
  accessId: AccessId;
}

/** Sends the invitation email. The list is refreshed whether it worked or not, so it never shows stale state. */
export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteInput) => api<InvitationDto>("POST", "/api/users/invitations", input),
    onSettled: () => qc.invalidateQueries({ queryKey: ["invitations"] }),
    // A reconnect flag set by a failed send changes what the Sender tab shows.
    onError: () => qc.invalidateQueries({ queryKey: ["sender"] }),
  });
}

export function useResendInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<InvitationDto>("POST", `/api/users/invitations/${encodeURIComponent(id)}/resend`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["invitations"] }),
    onError: () => qc.invalidateQueries({ queryKey: ["sender"] }),
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/users/invitations/${encodeURIComponent(id)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["invitations"] }),
  });
}

/** Removes a user from the tenant (the server soft-deletes: they are hidden, not erased, and can be invited again). */
export function useRemoveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/users/${encodeURIComponent(id)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}
