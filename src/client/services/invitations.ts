import { useMutation, useQuery } from "@tanstack/react-query";
import type { InvitationPreviewDto } from "@shared/api";
import { api } from "./http";

/** What the invitation page greets the person with. A bad link answers 404 INVITATION_INVALID. */
export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api<InvitationPreviewDto>("GET", `/api/invitations/${encodeURIComponent(token)}`),
    retry: false,
    staleTime: Infinity,
  });
}

/** Sets the password, creates the account and signs the person in (the server sets the session cookie). */
export function useAcceptInvitation(token: string) {
  return useMutation({
    mutationFn: (password: string) => api<{ redirectTo: string }>("POST", `/api/invitations/${encodeURIComponent(token)}/accept`, { password }),
  });
}
